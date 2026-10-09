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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
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

describe("the generated files of a schema with serialized worker channels", () => {
   it("type-checks the usage of the main process and of the worker, with the types of the signatures", async () => {
      project = await runFixture("serializer-worker");

      expect(await project.typecheck()).toBe("");
      expect(await project.typecheckWorker()).toBe("");
      expect(await project.typecheckWorker({ noUnusedLocals: true })).toBe("");
   }, 60_000);

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
      // Electron wraps what the handler throws in an Error of its own, which keeps the message only.
      await expect(one.invoke("shift", 1, 2)).rejects.toThrow(
         /^Error invoking remote method 'autoipc:shift': IpcSerializationError: /,
      );
   });
});
