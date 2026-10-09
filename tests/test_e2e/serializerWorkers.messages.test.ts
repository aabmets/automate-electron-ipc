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

import type { E2EProject } from "@testutils/e2e-utils.js";
import { settlePorts } from "@testutils/runtime-utils.js";
import { AT, date, settled } from "@testutils/serializer-wire-utils.js";
import { workerConnector } from "@testutils/serializer-worker-utils.js";
import { wire } from "@testutils/service-worker-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const connect = workerConnector((created) => {
   project = created;
});

/** Lets the promises and the messages run. */
const flush = () => settlePorts(10);

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
