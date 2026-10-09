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

import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { appointment, serializerConnector } from "@testutils/serializer-runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const connect = serializerConnector((created) => {
   project = created;
});

describe("fixture serializer, with a module in the project", () => {
   it("generates files that type-check, with the types the page and the main process see", async () => {
      project = await runFixture("serializer");

      expect(await project.typecheck()).toBe("");
   });

   it("fails the type-check when a Date is sent where the signature says it is a number", async () => {
      project = await runFixture("serializer");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace("// @ts-expect-error the page sends a Date", "//"));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });

   it("imports the module in main.ts and in preload.ts, and leaves window.d.ts alone", async () => {
      project = await runFixture("serializer");
      const line =
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "./serializer";';

      expect(project.generated["main.ts"]).toContain(line);
      expect(project.generated["preload.ts"]).toContain(line);
      expect(project.generated["window.d.ts"]).not.toContain("serializ");
   });

   it("sends the arguments as one wire value, and returns the result as one", async () => {
      const { page, ipc, pageElectron } = await connect();
      ipc.getAppointment.handle(async () => appointment());

      await page.getAppointment.invoke(1, new Date(0));

      const [wire, ...sent] = pageElectron.ipcRenderer.invoke.mock.calls[0];
      expect(wire).toBe("autoipc:getAppointment");
      expect(sent).toStrictEqual([{ json: [1, { $: "Date", v: "1970-01-01T00:00:00.000Z" }] }]);
   });
});

describe("generated serializer, invoke", () => {
   it("delivers a Date to the handler and brings a Set, a Map and a bigint back", async () => {
      const { page, ipc } = await connect();
      const handler = vi.fn(async () => appointment());
      ipc.getAppointment.handle(handler);
      const since = new Date("2026-01-02T03:04:05.000Z");

      const result = await page.getAppointment.invoke(7, since);

      expect(handler).toHaveBeenCalledOnce();
      const [, id, received] = handler.mock.calls[0] as unknown as [unknown, number, Date];
      expect(id).toBe(7);
      expect(received).toBeInstanceOf(Date);
      expect(received.toISOString()).toBe(since.toISOString());
      expect(result).toStrictEqual(appointment());
      expect(result.tags).toBeInstanceOf(Set);
      expect(result.attendees).toBeInstanceOf(Map);
   });

   it("serializes a call without arguments and a result that is undefined", async () => {
      const { page, ipc } = await connect();
      ipc.ping.handle(async () => undefined);

      await expect(page.ping.invoke()).resolves.toBeUndefined();
   });

   it("serializes the result of handleOnce as well", async () => {
      const { page, ipc } = await connect();
      ipc.getAppointment.handleOnce(async () => appointment());

      await expect(page.getAppointment.invoke(1, new Date(0))).resolves.toStrictEqual(
         appointment(),
      );
   });

   it("deserializes the arguments before the schema validates them", async () => {
      const { page, ipc } = await connect();
      const when = new Date("2026-05-05T05:05:05.000Z");
      ipc.checked.handle(async (_event: unknown, date: Date) => new Date(date.getTime() + 1000));

      const result = await page.checked.invoke(when);

      expect(result).toStrictEqual(new Date("2026-05-05T05:05:06.000Z"));
   });

   it("rejects a call that the schema refuses, with the validation error", async () => {
      const { ipc, mainElectron, event } = await connect();
      ipc.checked.handle(async (_event: unknown, date: Date) => date);
      const handle = mainElectron.ipcMain.handle.mock.calls.findLast(
         ([name]: [string]) => name === "autoipc:checked",
      )?.[1];

      // A well-formed wire value whose argument is not a Date.
      const reply = await handle(event, { json: ["not a date"] });

      expect(reply).toMatchObject({ ok: false, error: { code: "IPC_VALIDATION" } });
   });

   it("rejects in the page, without a call, when the arguments cannot be serialized", async () => {
      const { page, pageElectron } = await connect();

      const failure = await page.getAppointment.invoke(1, () => 1).catch((e: unknown) => e);

      expect(failure).toStrictEqual({
         name: "IpcSerializationError",
         message:
            "The data cannot be serialized of the channel 'getAppointment': cannot serialize a function",
         code: "IPC_SERIALIZATION",
      });
      expect(pageElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
   });

   it("answers a wire value that cannot be deserialized with an error, and runs no handler", async () => {
      const { ipc, mainElectron, event } = await connect();
      const handler = vi.fn();
      ipc.getAppointment.handle(handler);
      const handle = mainElectron.ipcMain.handle.mock.calls[0][1];

      const reply = await handle(event, { json: [{ $: "Bogus" }] });

      expect(reply).toMatchObject({
         ok: false,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
      expect(handler).not.toHaveBeenCalled();
   });

   it.each([
      ["raw arguments", [1, 2]],
      ["no argument", []],
      ["a wire value that holds no list", [{ json: 5 }]],
   ])(
      "answers %s with an error, since the message is not a serialized list",
      async (_name, args) => {
         const { ipc, mainElectron, event } = await connect();
         ipc.getAppointment.handle(vi.fn());
         const handle = mainElectron.ipcMain.handle.mock.calls[0][1];

         const reply = await handle(event, ...args);

         expect(reply).toMatchObject({ ok: false, error: { code: "IPC_SERIALIZATION" } });
      },
   );

   it("rejects the page with the error when the result cannot be serialized", async () => {
      const { page, ipc } = await connect();
      ipc.getAppointment.handle(async () => ({ at: () => 1 }));

      const failure = await page.getAppointment.invoke(1, new Date(0)).catch((e: unknown) => e);

      expect(failure).toMatchObject({ name: "IpcSerializationError", code: "IPC_SERIALIZATION" });
   });

   it("rejects the page when the answer cannot be deserialized", async () => {
      const { page, pageElectron } = await connect();
      pageElectron.ipcRenderer.invoke.mockResolvedValueOnce({
         ok: true,
         value: { json: { $: "Bogus" } },
      });

      const failure = await page.getAppointment.invoke(1, new Date(0)).catch((e: unknown) => e);

      expect(failure).toMatchObject({ name: "IpcSerializationError", code: "IPC_SERIALIZATION" });
   });

   it("still passes the error of the handler on, as a plain object", async () => {
      const { page, ipc } = await connect();
      ipc.ping.handle(() => {
         throw Object.assign(new Error("nope"), { code: "E_NOPE" });
      });

      await expect(page.ping.invoke()).rejects.toMatchObject({ message: "nope", code: "E_NOPE" });
   });

   it("does not run the deserializer for a sender that is rejected", async () => {
      const { page, ipc, spied } = await connect("serializer", { validateSender: true });
      ipc.getAppointment.handle(vi.fn(async () => appointment()));

      await expect(page.getAppointment.invoke(1, new Date(0))).rejects.toMatchObject({
         code: "IPC_FORBIDDEN",
      });

      // The page serialized its arguments; the main process deserialized nothing.
      expect(spied.deserialize).not.toHaveBeenCalled();
   });
});

describe("fixture serializer-raw-errors, with rawErrors on", () => {
   it("generates files that type-check", async () => {
      project = await runFixture("serializer-raw-errors");

      expect(await project.typecheck()).toBe("");
   });

   it("serializes the result of the handler itself, since there is no envelope", async () => {
      const { page, ipc, pageElectron } = await connect("serializer-raw-errors");
      ipc.nextDay.handle(
         async (_event: unknown, since: Date) => new Date(since.getTime() + 86_400_000),
      );

      const next = await page.nextDay.invoke(new Date("2026-01-01T00:00:00.000Z"));

      expect(next).toBeInstanceOf(Date);
      expect(next.toISOString()).toBe("2026-01-02T00:00:00.000Z");
      expect(pageElectron.ipcRenderer.invoke.mock.calls[0][0]).toBe("nextDay");
   });

   it("rejects, and does not throw at once, when the arguments cannot be serialized", async () => {
      const { page } = await connect("serializer-raw-errors");

      const promise = page.nextDay.invoke(() => 1);

      await expect(promise).rejects.toMatchObject({ code: "IPC_SERIALIZATION" });
   });

   it("rejects with Electron's error when the handler throws, and registers an async listener", async () => {
      const { page, ipc } = await connect("serializer-raw-errors");
      ipc.nextDay.handle(() => {
         throw new Error("failed");
      });

      await expect(page.nextDay.invoke(new Date(0))).rejects.toThrowError("failed");
   });
});

describe("a schema in which the main process sees no message", () => {
   it("imports the serializer in the preload script only, since the main process just pairs the pages", async () => {
      project = await runFixture("serializer-no-pages");

      expect(project.generated["main.ts"]).not.toContain("serializer");
      expect(project.generated["main.ts"]).not.toContain("ipcSerialize");
      expect(project.generated["preload.ts"]).toContain("ipcSerialize");
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
   });
});
