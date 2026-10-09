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
import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;

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

/** Lets the messages and the events of the real ports, and the promises, run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

/** What `Date`, `Set` and `Map` look like on the wire, in the serializer of the fixture. */
const date = (iso: string) => ({ $: "Date", v: iso });
const AT = "2026-10-09T10:00:00.000Z";
const EPOCH = "1970-01-01T00:00:00.000Z";

/** What a promise settles with, as a plain description. */
const settled = (promise: Promise<unknown>) =>
   promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );

/** The serializer module of the fixture, which the generated files import. */
async function loadSerializer() {
   const text = await fsp.readFile(path.join(project?.dir ?? "", "ipc", "serializer.ts"), "utf8");
   return loadGenerated(text, {});
}

/** The main process and the utility process of the fixture, wired to each other as Electron does. */
async function loadBoth() {
   project = await runFixture("serializer-utility");
   const serializer = await loadSerializer();
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

/** A `MessagePortMain` of the child, over a real `MessagePort`. */
class RealPortMain extends EventEmitter {
   private readonly raw: MessagePort;
   constructor(raw: MessagePort) {
      super();
      this.raw = raw;
      raw.addEventListener("message", (event) => this.emit("message", { data: event.data }));
      raw.addEventListener("close", () => this.emit("close"));
      rawPorts.push(raw);
   }
   start() {
      this.raw.start();
   }
   postMessage(message: unknown) {
      this.raw.postMessage(message);
   }
   close() {
      this.raw.close();
   }
}

/** A page, the child, and the real port between them, which the test can also read and write. */
async function loadBrokered() {
   project = await runFixture("serializer-utility");
   const serializer = await loadSerializer();
   const parentPort = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = parentPort;
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {
      "./serializer": serializer,
   });
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], {
      electron: fake.electron,
      "./serializer": serializer,
   });
   const listener = (channel: string) =>
      fake.electron.ipcRenderer.on.mock.calls.find(([name]: [string]) => name === channel)?.[1] as (
         event: unknown,
         key: unknown,
      ) => void;
   /** Pairs the page with the child for a channel, as the main process does. */
   const connect = (name: string) => {
      const channel = new MessageChannel();
      rawPorts.push(channel.port1, channel.port2);
      parentPort.emit("message", {
         data: { __ipc: "port", channel: wire(name), key: "1:utility" },
         ports: [new RealPortMain(channel.port1)],
      });
      listener(wire(name))({ ports: [channel.port2] }, "1:utility");
   };
   /** Pairs the page with a port that the test holds, instead of the child. */
   const holdPage = (name: string) => {
      const channel = new MessageChannel();
      rawPorts.push(channel.port1, channel.port2);
      listener(wire(name))({ ports: [channel.port2] }, "1:utility");
      return channel.port1;
   };
   /** Hands the child a port that the test holds, instead of a page. */
   const holdChild = (name: string) => {
      const channel = new MessageChannel();
      rawPorts.push(channel.port1, channel.port2);
      parentPort.emit("message", {
         data: { __ipc: "port", channel: wire(name), key: "1:utility" },
         ports: [new RealPortMain(channel.port1)],
      });
      return channel.port2;
   };
   return { utility: utility.ipc, page: fake.exposed.ipc, connect, holdPage, holdChild };
}

describe("a page and a utility process over a brokered port, with a serializer", () => {
   it("delivers a call, with a Date and a Map in the result, as they were", async () => {
      const { utility, page, connect } = await loadBrokered();
      const seen: unknown[] = [];
      utility.lookup.handle(async (at: Date) => {
         seen.push(at);
         return new Map([["at", at]]);
      });
      connect("lookup");

      const found = await page.lookup.invoke(new Date(AT));

      expect(seen[0]).toBeInstanceOf(Date);
      expect(found).toBeInstanceOf(Map);
      expect((found.get("at") as Date).toISOString()).toBe(AT);
   });

   it("posts the call as a list of one serialized value, and reads the reply the same way", async () => {
      const { utility, holdChild } = await loadBrokered();
      utility.lookup.handle(async (at: Date) => new Map([["at", at]]));
      const pagePort = holdChild("lookup");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "call",
         channel: wire("lookup"),
         id: 5,
         args: [{ json: [date(AT)] }],
      });
      await settle();

      expect(received).toStrictEqual([
         {
            __ipc: "reply",
            channel: wire("lookup"),
            id: 5,
            envelope: {
               ok: true,
               value: { json: { $: "Map", v: [["at", date(AT)]] } },
            },
         },
      ]);
   });

   it("rejects a call with arguments that cannot be serialized at once, with the plain error, and posts nothing", async () => {
      const { utility, page, holdPage } = await loadBrokered();
      const handler = vi.fn(async () => new Map());
      utility.lookup.handle(handler);
      const childPort = holdPage("lookup");
      const received: unknown[] = [];
      childPort.onmessage = (event) => received.push(event.data);

      const outcome = await settled(page.lookup.invoke(() => undefined));
      await settle();

      expect(outcome.error).toStrictEqual({
         name: "IpcSerializationError",
         message:
            "The data cannot be serialized of the channel 'lookup': cannot serialize a function",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toStrictEqual([]);
      expect(handler).not.toHaveBeenCalled();
   });

   it("answers an unreadable call with the error envelope in the child", async () => {
      const { utility, holdChild } = await loadBrokered();
      const handler = vi.fn(async () => new Map());
      utility.lookup.handle(handler);
      const pagePort = holdChild("lookup");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({ __ipc: "call", channel: wire("lookup"), id: 1, args: [new Date(AT)] });
      await settle();

      expect(handler).not.toHaveBeenCalled();
      expect(received[0].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
   });

   it("rejects the call of the page when the reply cannot be deserialized", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("lookup");
      childPort.onmessage = (event) =>
         childPort.postMessage({
            __ipc: "reply",
            channel: wire("lookup"),
            id: event.data.id,
            envelope: { ok: true, value: { json: { $: "Nope" } } },
         });

      const outcome = await settled(page.lookup.invoke(new Date(AT)));

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });

   it("streams Dates from the child, serializing the arguments and each chunk", async () => {
      const { utility, page, connect } = await loadBrokered();
      const seen: unknown[] = [];
      utility.dates.handle(async function* (since: Date) {
         seen.push(since);
         yield since;
         yield new Date(0);
      });
      connect("dates");

      const dates: Date[] = [];
      for await (const at of page.dates.stream(new Date(AT))) {
         dates.push(at);
      }

      expect(seen[0]).toBeInstanceOf(Date);
      expect(dates.map((at) => at.toISOString())).toStrictEqual([AT, EPOCH]);
   });

   it("posts the stream and its chunks in the wire shape", async () => {
      const { utility, holdChild } = await loadBrokered();
      utility.dates.handle(async function* (since: Date) {
         yield since;
      });
      const pagePort = holdChild("dates");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "stream",
         channel: wire("dates"),
         id: 3,
         args: [{ json: [date(AT)] }],
      });
      await settle();

      expect(received.map((message) => message.__ipc)).toStrictEqual(["chunk", "end"]);
      expect(received[0].value).toStrictEqual({ json: date(AT) });
   });

   it("fails a stream whose arguments cannot be read, before the first chunk", async () => {
      const { utility, holdChild } = await loadBrokered();
      const handler = vi.fn(async function* () {
         yield new Date(0);
      });
      utility.dates.handle(handler);
      const pagePort = holdChild("dates");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "stream",
         channel: wire("dates"),
         id: 3,
         args: [new Date(AT)],
      });
      await settle();

      expect(handler).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
         __ipc: "error",
         id: 3,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
   });

   it("fails a stream with the error when a chunk cannot be serialized, and stops the generator", async () => {
      const { utility, page, connect } = await loadBrokered();
      let finished = 0;
      utility.dates.handle(async function* () {
         try {
            yield new Date(0);
            yield (() => undefined) as unknown as Date;
            yield new Date(1);
         } finally {
            finished += 1;
         }
      });
      connect("dates");

      const stream = page.dates.stream(new Date(AT));
      expect(((await stream.next()).value as Date).getTime()).toBe(0);
      const outcome = await settled(stream.next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(finished).toBe(1);
   });

   it("fails a stream of the page with the plain error when the arguments cannot be serialized", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("dates");
      const received: unknown[] = [];
      childPort.onmessage = (event) => received.push(event.data);

      const outcome = await settled(page.dates.stream(() => undefined).next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toStrictEqual([]);
   });

   it("fails a stream of the page when a chunk cannot be deserialized, and cancels it in the child", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("dates");
      const received: Record<string, any>[] = [];
      childPort.onmessage = (event) => {
         received.push(event.data);
         if (event.data.__ipc === "stream") {
            childPort.postMessage({
               __ipc: "chunk",
               channel: wire("dates"),
               id: event.data.id,
               value: { json: { $: "Nope" } },
            });
         }
      };

      const outcome = await settled(page.dates.stream(new Date(AT)).next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(received.map((message) => message.__ipc)).toContain("cancel");
   });
});
