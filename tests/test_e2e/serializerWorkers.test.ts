/*
 *   Apache License 2.0
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: Apache-2.0
 */

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await

import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { createSession, createWorker, wire } from "@testutils/service-worker-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

/** Lets the promises and the messages run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

/** What `Date`, `Set` and `Map` look like on the wire, in the serializer of the fixture. */
const date = (iso: string) => ({ $: "Date", v: iso });
const AT = "2026-10-09T10:00:00.000Z";

/** What a promise settles with, as a plain description. */
const settled = (promise: Promise<unknown>) =>
   promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );

/**
 * The main process and the preload script of a service worker, wired to each other the way
 * Electron does it: what crosses is structured cloned, and a message reaches the listeners of the
 * other side. `main.ipc.<name>` is the API of the main process, `api.<name>` the one of the worker.
 */
async function connect(fixture = "serializer-worker", wireToWorker = true) {
   project = await runFixture(fixture);
   const text = await fsp.readFile(path.join(project.dir, "ipc", "serializer.ts"), "utf8");
   const real = loadGenerated(text, {});
   // The calls are counted, so that a test sees whether the serializer was used at all.
   const serializer = {
      serialize: vi.fn(real.serialize),
      deserialize: vi.fn(real.deserialize),
   };
   const validators = await fsp
      .readFile(path.join(project.dir, "ipc", "validators.ts"), "utf8")
      .then((source) => loadGenerated(source, {}))
      .catch(() => ({}));
   const main = loadGenerated(project.generated["main.ts"], {
      electron: createFakeElectron(),
      "./serializer": serializer,
      "./validators": validators,
   });
   const fakePreload = createFakePreloadElectron();
   loadGenerated(project.generated["service-worker-preload.ts"] ?? "", {
      electron: fakePreload.electron,
      "./serializer": serializer,
   });
   const { ipcRenderer } = fakePreload.electron;
   const api = fakePreload.exposed.ipc;

   const fake = createSession();
   const one = createWorker(1);
   main.attachServiceWorkers(fake.session);
   fake.start(one);
   const event = { type: "service-worker", versionId: 1, serviceWorker: one.worker };
   /** What crossed the wire, in each direction. */
   const toMain: unknown[][] = [];
   const toWorker: unknown[][] = [];

   ipcRenderer.invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      toMain.push([channel, ...args]);
      const handler = one.handlers.get(channel);
      return structuredClone(await handler?.(event, ...structuredClone(args)));
   });
   ipcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
      toMain.push([channel, ...args]);
      for (const listener of one.listeners.get(channel) ?? []) {
         listener(event, ...structuredClone(args));
      }
   });
   one.worker.send.mockImplementation((channel: string, ...args: unknown[]) => {
      toWorker.push([channel, ...args]);
      if (!wireToWorker) {
         return;
      }
      for (const [name, listener] of ipcRenderer.on.mock.calls) {
         if (name === channel) {
            listener({}, ...structuredClone(args));
         }
      }
   });
   return { main, api, fake, one, ipcRenderer, serializer, toMain, toWorker };
}

describe("the generated files of a schema with serialized worker channels", () => {
   it("type-checks the usage of the main process and of the worker, with the types of the signatures", async () => {
      project = await runFixture("serializer-worker");

      expect(await project.typecheck()).toBe("");
      expect(await project.typecheckWorker()).toBe("");
      expect(await project.typecheckWorker({ noUnusedLocals: true })).toBe("");
   });

   it("imports the serializer in main.ts and in the script of the worker, not in the page files", async () => {
      project = await runFixture("serializer-worker");
      const line =
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "./serializer";';

      expect(project.generated["main.ts"]).toContain(line);
      expect(project.generated["service-worker-preload.ts"]).toContain(line);
      expect(project.generated["service-worker.d.ts"]).not.toContain("serializ");
      expect(project.generated["preload.ts"] ?? "").not.toContain("serializ");
   });
});

describe("a call of a worker, with a serializer", () => {
   it("delivers the arguments and the result as they were, and puts one serialized value on the wire", async () => {
      const { main, api, fake, one, toMain } = await connect();
      const seen: unknown[] = [];
      main.ipc.shift.handle(fake.session, async (_event: unknown, at: Date, by: number) => {
         seen.push(at);
         return new Date(at.getTime() + by);
      });

      const shifted = await api.shift.invoke(new Date(AT), 1000);

      expect(shifted).toBeInstanceOf(Date);
      expect(shifted.toISOString()).toBe("2026-10-09T10:00:01.000Z");
      expect(seen[0]).toBeInstanceOf(Date);
      expect(toMain[0]).toStrictEqual([wire("shift"), { json: [date(AT), 1000] }]);
      expect(await one.invoke("shift", { json: [date(AT), 1000] })).toStrictEqual({
         ok: true,
         value: { json: date("2026-10-09T10:00:01.000Z") },
      });
   });

   it("answers a call that cannot be read with the serialization error, and does not run the handler", async () => {
      const { main, fake, one } = await connect();
      const handler = vi.fn(async () => new Date());
      main.ipc.shift.handle(fake.session, handler);

      for (const sent of [[], [1, 2], [{ json: 5 }], [{ json: { $: "Nope" } }]]) {
         // biome-ignore lint/performance/noAwaitInLoops: the calls are checked one by one
         const answer = (await one.invoke("shift", ...sent)) as any;

         expect(answer.ok).toBe(false);
         expect(answer.error).toMatchObject({
            name: "IpcSerializationError",
            code: "IPC_SERIALIZATION",
         });
      }
      expect(handler).not.toHaveBeenCalled();
   });

   it("answers a result that cannot be serialized with the serialization error", async () => {
      const { main, fake, one } = await connect();
      main.ipc.shift.handle(fake.session, async () => (() => 1) as unknown as Date);

      const answer = (await one.invoke("shift", { json: [date(AT), 1] })) as any;

      expect(answer.ok).toBe(false);
      expect(answer.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(answer.error.message).toContain(
         "The data cannot be serialized of the channel 'shift'",
      );
   });

   it("rejects in the worker, at once and with nothing on the wire, for arguments that cannot be serialized", async () => {
      const { api, toMain } = await connect();

      const outcome = (await settled(api.shift.invoke(() => 1, 1))) as any;

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(toMain).toStrictEqual([]);
   });

   it("rejects in the worker for a result it cannot read", async () => {
      const { api, ipcRenderer } = await connect();
      ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, value: { json: { $: "Nope" } } });

      const outcome = (await settled(api.shift.invoke(new Date(AT), 1))) as any;

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });

   it("checks the sender before anything is deserialized", async () => {
      const { main, fake, one, serializer } = await connect();
      const handler = vi.fn(async () => new Date());
      main.ipc.shift.handle(fake.session, handler);
      main.configureServiceWorkerIpc({ validateSender: () => false });

      const answer = (await one.invoke("shift", { json: { $: "Nope" } })) as any;

      expect(answer.error.code).toBe("IPC_WORKER_FORBIDDEN");
      expect(serializer.deserialize).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
   });

   it("deserializes first and validates then, so the schema sees the Date", async () => {
      const { main, api, fake, one, serializer } = await connect();
      main.ipc.checked.handle(fake.session, (_event: unknown, at: Date) => at);

      const echoed = await api.checked.invoke(new Date(AT));
      expect(echoed).toBeInstanceOf(Date);
      expect(echoed.toISOString()).toBe(AT);

      // A value that is not a Date fails the schema, which is only reached when the message is readable.
      const invalid = (await one.invoke("checked", { json: [5] })) as any;
      expect(invalid.error).toMatchObject({ name: "IpcValidationError", code: "IPC_VALIDATION" });
      serializer.deserialize.mockClear();
      const unreadable = (await one.invoke("checked", { json: { $: "Nope" } })) as any;
      expect(unreadable.error.code).toBe("IPC_SERIALIZATION");
   });

   it("keeps the handler of handleOnce for a call that can be read", async () => {
      const { main, fake, one } = await connect();
      const handler = vi.fn(async (_event: unknown, at: Date) => at);
      main.ipc.shift.handleOnce(fake.session, handler);

      await one.invoke("shift", { json: { $: "Nope" } });
      expect(handler).not.toHaveBeenCalled();
      const answer = (await one.invoke("shift", { json: [date(AT), 1] })) as any;

      expect(answer.ok).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
   });
});

describe("a call of a worker, with a serializer and rawErrors", () => {
   it("returns the encoded result, and rejects with the serialization error of an unreadable call", async () => {
      const { main, api, fake, one } = await connect("serializer-worker-raw-errors");
      main.ipc.shift.handle(fake.session, async (_event: unknown, at: Date, by: number) => {
         return new Date(at.getTime() + by);
      });

      const shifted = await api.shift.invoke(new Date(AT), 1000);
      expect(shifted).toBeInstanceOf(Date);
      expect(shifted.toISOString()).toBe("2026-10-09T10:00:01.000Z");
      // The call is raw: the value of the reply is the serialized value, with no envelope.
      expect(await one.invoke("shift", { json: [date(AT), 1000] })).toStrictEqual({
         json: date("2026-10-09T10:00:01.000Z"),
      });
      await expect(one.invoke("shift", 1, 2)).rejects.toBeInstanceOf(main.IpcSerializationError);
   });
});

describe("a message of a worker, with a serializer", () => {
   it("delivers the arguments as they were, and puts one serialized value on the wire", async () => {
      const { main, api, fake, toMain } = await connect();
      const heard: unknown[][] = [];
      main.ipc.tell.on(fake.session, (_event: unknown, ...args: unknown[]) => heard.push(args));

      api.tell.send(new Date(AT), new Set(["a", "b"]));

      expect(toMain[0]).toStrictEqual([
         wire("tell"),
         { json: [date(AT), { $: "Set", v: ["a", "b"] }] },
      ]);
      expect((heard[0][0] as Date).toISOString()).toBe(AT);
      expect(heard[0][1]).toStrictEqual(new Set(["a", "b"]));
   });

   it("throws in the worker for arguments that cannot be serialized, and sends nothing", async () => {
      const { api, toMain } = await connect();

      expect(() => api.tell.send(() => 1, new Set())).toThrowError(
         expect.objectContaining({ name: "IpcSerializationError", code: "IPC_SERIALIZATION" }),
      );
      expect(toMain).toStrictEqual([]);
   });

   it("logs and drops a message that cannot be read, without using up a once listener", async () => {
      const { main, fake, one } = await connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      main.ipc.tell.once(fake.session, listener);

      one.sendFrom("tell", { json: { $: "Nope" } });
      one.sendFrom("tell", 1, 2);

      expect(listener).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });

      one.sendFrom("tell", { json: [date(AT), { $: "Set", v: [] }] });
      expect(listener).toHaveBeenCalledOnce();
   });

   it("does not read a message when nobody listens", async () => {
      const { one, serializer } = await connect();

      one.sendFrom("tell", { json: [date(AT), { $: "Set", v: [] }] });

      expect(serializer.deserialize).not.toHaveBeenCalled();
   });

   it("checks the sender before it reads, and validates what it has read", async () => {
      const { main, fake, one, serializer } = await connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      const rejected = vi.fn();
      main.ipc.checkedTell.on(fake.session, listener);
      main.configureServiceWorkerIpc({ onRejected: rejected });

      one.sendFrom("checkedTell", { json: [date(AT)] });
      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0][1] as Date).toISOString()).toBe(AT);

      one.sendFrom("checkedTell", { json: [5] });
      expect(listener).toHaveBeenCalledOnce();
      expect(rejected).toHaveBeenCalledOnce();
      expect(rejected.mock.calls[0][2]).toMatchObject({ code: "IPC_VALIDATION" });

      serializer.deserialize.mockClear();
      main.configureServiceWorkerIpc({ validateSender: () => false });
      one.sendFrom("checkedTell", { json: { $: "Nope" } });
      expect(serializer.deserialize).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
   });
});

describe("a question to a worker, with a serializer", () => {
   it("sends the arguments as one serialized value and resolves with the deserialized answer", async () => {
      const { main, api, one, ipcRenderer, toWorker } = await connect();
      api.zone.handle(async (at: Date) => new Map([["at", at]]));

      const answer = await main.ipc.zone.invoke(one.worker, new Date(AT));

      expect(answer).toBeInstanceOf(Map);
      expect((answer.get("at") as Date).toISOString()).toBe(AT);
      expect(toWorker[0]).toStrictEqual([wire("zone"), one.lastId(), { json: [date(AT)] }]);
      expect(ipcRenderer.send).toHaveBeenCalledWith(wire("zone:reply"), one.lastId(), {
         ok: true,
         value: { json: { $: "Map", v: [["at", date(AT)]] } },
      });
   });

   it("rejects at once, and neither starts a task nor sends, when the question cannot be serialized", async () => {
      const { main, one } = await connect();

      const outcome = (await settled(main.ipc.zone.invoke(one.worker, (() => 1) as never))) as any;

      expect(outcome.error).toBeInstanceOf(main.IpcSerializationError);
      expect(outcome.error.code).toBe("IPC_SERIALIZATION");
      expect(one.worker.startTask).not.toHaveBeenCalled();
      expect(one.worker.send).not.toHaveBeenCalled();
   });

   it("rejects with IPC_ASK_INVALID_REPLY for an answer that cannot be read, and ends the task", async () => {
      const { main, one } = await connect("serializer-worker", false);

      const answer = settled(main.ipc.zone.invoke(one.worker, new Date(AT)));
      one.reply("zone", one.lastId(), { ok: true, value: { json: { $: "Nope" } } });

      const outcome = (await answer) as any;
      expect(outcome.error.code).toBe("IPC_ASK_INVALID_REPLY");
      expect(outcome.error.message).toContain("The answer cannot be read");
      expect(one.end).toHaveBeenCalledOnce();
   });

   it("still passes the error of the responder through as it was", async () => {
      const { main, api, one } = await connect();
      api.zone.handle(async () => {
         throw Object.assign(new Error("no zone"), { name: "ZoneError", code: "NO_ZONE" });
      });

      const outcome = (await settled(main.ipc.zone.invoke(one.worker, new Date(AT)))) as any;

      expect(outcome.error).toMatchObject({ code: "NO_ZONE", message: "no zone" });
   });

   it("answers a question that cannot be read with the serialization error, and does not run the responder", async () => {
      const { api, one, ipcRenderer } = await connect();
      const responder = vi.fn(async () => new Map());
      api.zone.handle(responder);

      one.worker.send(wire("zone"), 41, 1, 2);
      one.worker.send(wire("zone"), 42, { json: { $: "Nope" } });
      await flush();

      expect(responder).not.toHaveBeenCalled();
      for (const id of [41, 42]) {
         expect(ipcRenderer.send).toHaveBeenCalledWith(
            wire("zone:reply"),
            id,
            expect.objectContaining({
               ok: false,
               error: expect.objectContaining({ code: "IPC_SERIALIZATION" }),
            }),
         );
      }
   });
});

describe("a message to a worker, with a serializer", () => {
   it("delivers the arguments as they were, and posts one serialized value", async () => {
      const { main, api, fake, one, toWorker } = await connect();
      const heard: unknown[][] = [];
      api.tick.on((...args: unknown[]) => heard.push(args));

      main.ipc.tick.send(one.worker, new Date(AT), new Map([["a", 1]]));
      main.ipc.tick.broadcast(fake.session, new Date(AT), new Map([["b", 2]]));

      expect(toWorker[0]).toStrictEqual([
         wire("tick"),
         { json: [date(AT), { $: "Map", v: [["a", 1]] }] },
      ]);
      expect(heard).toHaveLength(2);
      expect((heard[0][0] as Date).toISOString()).toBe(AT);
      expect(heard[0][1]).toStrictEqual(new Map([["a", 1]]));
      expect(heard[1][1]).toStrictEqual(new Map([["b", 2]]));
   });

   it("throws the serialization error and sends nothing when the arguments cannot be serialized", async () => {
      const { main, fake, one } = await connect();
      const bad = () => 1;

      expect(() => main.ipc.tick.send(one.worker, bad, new Map())).toThrowError(
         main.IpcSerializationError,
      );
      expect(() => main.ipc.tick.broadcast(fake.session, bad, new Map())).toThrowError(
         main.IpcSerializationError,
      );
      expect(one.worker.send).not.toHaveBeenCalled();
   });

   it("logs and drops a message that the worker cannot read", async () => {
      const { api, one } = await connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const callback = vi.fn();
      api.tick.on(callback);

      one.worker.send(wire("tick"), 1, 2);
      one.worker.send(wire("tick"), { json: { $: "Nope" } });

      expect(callback).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
   });
});
