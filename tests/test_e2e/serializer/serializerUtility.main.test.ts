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

import { EventEmitter } from "node:events";
import { createFakeElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { AT, date, loadSerializer, settled } from "@testutils/e2e/serializer-wire-utils.js";
import { settle, wire } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;
const rawPorts: MessagePort[] = [];

afterEach(async () => {
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
});

/** The main process and the utility process of the fixture, wired to each other as Electron does. */
async function loadBoth() {
   project = await runFixture("serializer-utility");
   const serializer = await loadSerializer(project);
   const main = loadGenerated(project.generated["main.ts"], {
      electron: createFakeElectron(),
      "./serializer": serializer,
   });
   const parentPort = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = parentPort;
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {
      "./serializer": serializer,
   });
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   main.attachUtility(child);
   /** What each side posted, which crossed the wire. */
   const toChild: Record<string, any>[] = [];
   const toMain: Record<string, any>[] = [];
   child.postMessage.mockImplementation((message: Record<string, any>) => {
      toChild.push(message);
      parentPort.emit("message", { data: structuredClone(message) });
   });
   parentPort.postMessage.mockImplementation((message: Record<string, any>) => {
      toMain.push(message);
      child.emit("message", structuredClone(message));
   });
   return { main, utility, child, parentPort, toChild, toMain };
}

describe("the generated files of a schema with serialized utility channels", () => {
   it("type-checks the usage of the three sides, with the types of the signatures", async () => {
      project = await runFixture("serializer-utility");

      expect(await project.typecheck()).toBe("");
   });

   it("imports the serializer where the messages are seen: the utility file and the page, and main for its own channels", async () => {
      project = await runFixture("serializer-utility");
      const line =
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "./serializer";';

      expect(project.generated["main.ts"]).toContain(line);
      expect(project.generated["utility.ts"]).toContain(line);
      expect(project.generated["preload.ts"]).toContain(line);
      expect(project.generated["window.d.ts"]).not.toContain("serializ");
   });

   it("leaves the serializer out of main.ts and the page when only the pages talk to the child", async () => {
      project = await runFixture("utility-ports-only");

      expect(project.generated["main.ts"]).not.toContain("serializ");
      expect(project.generated["utility.ts"]).not.toContain("serializ");
   });
});

describe("main and a utility process, with a serializer", () => {
   it("delivers a call and its result as they were, and posts the arguments as one serialized value", async () => {
      const { main, utility, child, toChild, toMain } = await loadBoth();
      utility.ipc.shift.handle(async (at: Date, by: number) => new Date(at.getTime() + by));

      const shifted = await main.ipc.shift.invoke(child, new Date(AT), 1000);

      expect(shifted).toBeInstanceOf(Date);
      expect(shifted.toISOString()).toBe("2026-10-09T10:00:01.000Z");
      expect(toChild[0].args).toStrictEqual([{ json: [date(AT), 1000] }]);
      expect(toMain[0].envelope).toStrictEqual({
         ok: true,
         value: { json: date("2026-10-09T10:00:01.000Z") },
      });
   });

   it("delivers a send with a Date and a Set to the listeners of the child", async () => {
      const { main, utility, child, toChild } = await loadBoth();
      const heard: unknown[][] = [];
      utility.ipc.tell.on((...args: unknown[]) => heard.push(args));

      main.ipc.tell.send(child, new Date(AT), new Set(["a", "b"]));

      expect(toChild[0].args).toStrictEqual([{ json: [date(AT), { $: "Set", v: ["a", "b"] }] }]);
      expect((heard[0][0] as Date).toISOString()).toBe(AT);
      expect(heard[0][1]).toStrictEqual(new Set(["a", "b"]));
   });

   it("serves the calls and the sends of the child in the other direction", async () => {
      const { main, utility, child } = await loadBoth();
      main.ipc.clock.handle(child, async () => new Date(AT));
      const heard: unknown[][] = [];
      main.ipc.tick.on(child, (...args: unknown[]) => heard.push(args));

      const now = await utility.ipc.clock.invoke();
      utility.ipc.tick.send(new Date(0), new Map([["ada", 2]]));

      expect(now.toISOString()).toBe(AT);
      expect((heard[0][0] as Date).getTime()).toBe(0);
      expect(heard[0][1]).toStrictEqual(new Map([["ada", 2]]));
   });

   it("rejects a call whose arguments cannot be serialized with an IpcSerializationError, and posts nothing", async () => {
      const { main, child, toChild } = await loadBoth();

      const outcome = await settled(main.ipc.shift.invoke(child, () => undefined, 1));

      expect(outcome.error).toBeInstanceOf(main.IpcSerializationError);
      expect(outcome.error).toMatchObject({
         code: "IPC_SERIALIZATION",
         channel: wire("shift"),
         message: `The data cannot be serialized of the channel '${wire("shift")}': cannot serialize a function`,
      });
      expect(toChild).toStrictEqual([]);
   });

   it("throws an IpcSerializationError from a send that cannot be serialized, in both files", async () => {
      const { main, utility, child, toChild, toMain } = await loadBoth();

      expect(() => main.ipc.tell.send(child, () => undefined, new Set())).toThrowError(
         main.IpcSerializationError,
      );
      expect(() => utility.ipc.tick.send(() => undefined, new Map())).toThrowError(
         utility.IpcSerializationError,
      );
      expect(toChild).toStrictEqual([]);
      expect(toMain).toStrictEqual([]);
   });

   it("answers a call that cannot be read with the error envelope, and does not run the handler", async () => {
      const { utility, parentPort, toMain } = await loadBoth();
      const handler = vi.fn(async (at: Date) => at);
      utility.ipc.shift.handle(handler);

      // A call from a main process that was built without the serializer: the arguments as they are.
      parentPort.emit("message", {
         data: { __ipc: "call", channel: wire("shift"), id: 99, args: [new Date(AT), 1] },
      });
      await settle();

      expect(handler).not.toHaveBeenCalled();
      expect(toMain[0]).toMatchObject({
         __ipc: "reply",
         id: 99,
         envelope: {
            ok: false,
            error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
         },
      });
   });

   it("rejects the caller with an IpcUtilityError that has the name and code of the error it was answered with", async () => {
      const { main, child, toChild } = await loadBoth();
      const answer = settled(main.ipc.shift.invoke(child, new Date(AT), 1));

      child.emit("message", {
         __ipc: "reply",
         channel: wire("shift"),
         id: toChild[0].id,
         envelope: {
            ok: false,
            error: {
               name: "IpcSerializationError",
               message: "The data cannot be deserialized",
               code: "IPC_SERIALIZATION",
            },
         },
      });

      const outcome = await answer;
      expect(outcome.error).toBeInstanceOf(main.IpcUtilityError);
      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });

   it("answers with the error when the result of a handler cannot be serialized", async () => {
      const { main, utility, child } = await loadBoth();
      utility.ipc.shift.handle(async () => (() => undefined) as unknown as Date);

      const outcome = await settled(main.ipc.shift.invoke(child, new Date(AT), 1));

      expect(outcome.error).toBeInstanceOf(main.IpcUtilityError);
      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });

   it("rejects the call when its result cannot be deserialized", async () => {
      const { main, child, toChild } = await loadBoth();
      const answer = settled(main.ipc.shift.invoke(child, new Date(AT), 1));

      child.emit("message", {
         __ipc: "reply",
         channel: wire("shift"),
         id: toChild[0].id,
         envelope: { ok: true, value: { json: { $: "Nope" } } },
      });

      const outcome = await answer;
      expect(outcome.error).toBeInstanceOf(main.IpcSerializationError);
      expect(outcome.error).toMatchObject({ code: "IPC_SERIALIZATION", channel: wire("shift") });
   });

   it("logs and drops a send that cannot be read, goes on with the next, and keeps a once listener", async () => {
      const { main, utility, child, parentPort } = await loadBoth();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const heard: unknown[][] = [];
      utility.ipc.tell.once((...args: unknown[]) => heard.push(args));
      const tell = (args: unknown[]) =>
         parentPort.emit("message", { data: { __ipc: "send", channel: wire("tell"), args } });

      // An unknown tag, a list of two values, a value that is not a list of arguments.
      tell([{ json: { $: "Nope" } }]);
      tell([{ json: [] }, { json: [] }]);
      tell([{ json: "text" }]);
      expect(heard).toStrictEqual([]);
      main.ipc.tell.send(child, new Date(AT), new Set());

      expect(error).toHaveBeenCalledTimes(3);
      expect(error.mock.calls[0][0]).toBeInstanceOf(utility.IpcSerializationError);
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });
      expect(heard).toHaveLength(1);
   });

   it("logs and drops a send of the child that cannot be read in main as well", async () => {
      const { main, child } = await loadBoth();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const heard: unknown[][] = [];
      main.ipc.tick.on(child, (...args: unknown[]) => heard.push(args));

      child.emit("message", { __ipc: "send", channel: wire("tick"), args: [1, 2] });

      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toBeInstanceOf(main.IpcSerializationError);
      expect(heard).toStrictEqual([]);
   });
});
