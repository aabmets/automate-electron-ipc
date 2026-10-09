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
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   createSource,
   finishLoading,
   loadGenerated,
   startLoading,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const closeWire = (name: string) => `autoipc:${name}:close`;

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

/** Lets the promises and the events of the ports run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent to it. */
function createContents(state: { loading?: boolean; url?: string; id?: number } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      id: state.id ?? 1,
      loading: state.loading ?? false,
      url: state.url ?? "app://.",
      destroyed: false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}
type FakeContents = ReturnType<typeof createContents>;

/** Destroys contents the way Electron does: they emit `destroyed` once they cannot be used. */
function destroy(contents: FakeContents) {
   contents.destroyed = true;
   contents.emit("destroyed");
}

/** A `UtilityProcess` stand-in, which the main process pairs the page with. */
function createChild() {
   return Object.assign(new EventEmitter(), { postMessage: vi.fn() });
}

/** The ports a `MessageChannelMain` made, in order. */
const channelsMade: { port1: { close: ReturnType<typeof vi.fn> }; port2: object }[] = [];

class FakeChannelMain {
   port1 = { name: `port1 of ${channelsMade.length + 1}`, close: vi.fn() };
   port2 = { name: `port2 of ${channelsMade.length + 1}`, close: vi.fn() };
   constructor() {
      channelsMade.push(this);
   }
}

async function loadMain(channelClass: unknown = FakeChannelMain) {
   project = await runFixture("utility-ports");
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass };
   return loadGenerated(project.generated["main.ts"], { electron }).ipc;
}

describe("utility ports, files", () => {
   it("type-checks main.ts, utility.ts, the preload script and window.d.ts, and the code which uses them", async () => {
      project = await runFixture("utility-ports");
      expect(await project.typecheck()).toBe("");
   });

   it("type-checks a schema which has only a channel from a page to a utility process", async () => {
      project = await runFixture("utility-ports-only");
      expect(await project.typecheck()).toBe("");
      expect(project.generated["utility.ts"]).toContain("setBrokerCall(");
      expect(project.generated["main.ts"]).toContain("function connectUtilityPort(");
      expect(project.generated["main.ts"]).not.toContain("function getUtilityPeer(");
      expect(project.generated["main.ts"]).not.toContain("ipcMain");
      expect(project.generated["main.ts"]).not.toContain("import type { Row");
   });

   it("exposes the calls to the page, and the connect to the main process only", async () => {
      project = await runFixture("utility-ports");
      const preload = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: preload.electron });
      const paths = [
         "asForm.invoke",
         "countRows.invoke",
         "counter.stream",
         "getUser.invoke",
         "ping.invoke",
         "pulledRows.stream",
         "queryRows.invoke",
         "scanRows.stream",
         "streamForm.stream",
         "tagged.invoke",
         "unboundedRows.stream",
         "windowedRows.stream",
      ];
      expect(callablePaths(preload.exposed.ipc)).toStrictEqual(paths);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual(paths);
      expect(project.generated["preload.ts"]).not.toContain("indexFile");
      expect(project.generated["window.d.ts"]).not.toContain("indexFile");

      const main = await loadMain();
      expect(callablePaths(main)).toContain("queryRows.connect");
      expect(callablePaths(main)).not.toContain("queryRows.invoke");
   });

   it("declares IpcUtilityError for the page only when a channel to a utility process exists", async () => {
      project = await runFixture("utility-ports");
      expect(project.generated["window.d.ts"]).toContain("type IpcUtilityError = Error & {");
      await project.cleanup();

      project = await runFixture("utility-channels");
      expect(project.generated["window.d.ts"]).not.toContain("IpcUtilityError");
   });
});

describe("utility ports, main process, ipc.<name>.connect", () => {
   it("pairs at once when the page has loaded: port1 to the child, port2 to the page, with one key", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();

      const link = ipc.queryRows.connect(child, { webContents: contents });

      expect(link).toStrictEqual({ close: expect.any(Function) });
      expect(channelsMade).toHaveLength(1);
      const [message, transfer] = child.postMessage.mock.calls[0];
      expect(message).toStrictEqual({
         __ipc: "port",
         channel: wire("queryRows"),
         key: expect.any(String),
      });
      expect(transfer).toStrictEqual([channelsMade[0].port1]);
      expect(contents.postMessage).toHaveBeenCalledWith(wire("queryRows"), message.key, [
         channelsMade[0].port2,
      ]);
   });

   it("accepts a window, a view and contents", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const [one, two, three] = [1, 2, 3].map((id) => createContents({ id }));

      ipc.queryRows.connect(child, { webContents: one });
      ipc.scanRows.connect(child, two);
      ipc.counter.connect(child, { webContents: three });

      expect(one.postMessage).toHaveBeenCalledTimes(1);
      expect(two.postMessage).toHaveBeenCalledTimes(1);
      expect(three.postMessage).toHaveBeenCalledTimes(1);
   });

   it("waits for the page to load, since an earlier port arrives before the preload script listens", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });

      ipc.queryRows.connect(child, contents);
      expect(channelsMade).toHaveLength(0);
      expect(child.postMessage).not.toHaveBeenCalled();

      finishLoading(contents);

      expect(channelsMade).toHaveLength(1);
      expect(child.postMessage).toHaveBeenCalledTimes(1);
      expect(contents.postMessage).toHaveBeenCalledTimes(1);
   });

   it("pairs again on every load with the same key, so that a page that reloads gets a fresh port", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);

      startLoading(contents);
      finishLoading(contents);

      expect(channelsMade).toHaveLength(2);
      const keys = child.postMessage.mock.calls.map(([message]) => message.key);
      expect(keys[1]).toBe(keys[0]);
      expect(contents.postMessage.mock.calls[1]).toStrictEqual([
         wire("queryRows"),
         keys[0],
         [channelsMade[1].port2],
      ]);
   });

   it("does not pair after a main frame fails to load", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });
      ipc.queryRows.connect(child, contents);

      startLoading(contents);
      contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://x", true);
      contents.loading = false;
      contents.emit("did-stop-loading");

      expect(channelsMade).toHaveLength(0);
   });

   it("ends the connection with close: the page is told with the key, and nothing is paired later", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      const link = ipc.queryRows.connect(child, contents);
      const key = child.postMessage.mock.calls[0][0].key;

      link.close();
      link.close();

      expect(contents.send).toHaveBeenCalledTimes(1);
      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), key);
      expect(child.listenerCount("exit")).toBe(0);
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("did-finish-load")).toBe(0);
      startLoading(contents);
      finishLoading(contents);
      expect(channelsMade).toHaveLength(1);
   });

   it("ends the connection when the child exits", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);
      const key = child.postMessage.mock.calls[0][0].key;

      child.emit("exit", 1);

      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), key);
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("ends the connection when the contents are destroyed, without touching them", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);

      destroy(contents);

      expect(contents.send).not.toHaveBeenCalled();
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("replaces the connection of the same channel and page, which cannot fight for the port on a reload", async () => {
      const ipc = await loadMain();
      const first = createChild();
      const second = createChild();
      const contents = createContents();
      ipc.queryRows.connect(first, contents);
      const oldKey = first.postMessage.mock.calls[0][0].key;

      ipc.queryRows.connect(second, contents);

      const newKey = second.postMessage.mock.calls[0][0].key;
      expect(newKey).not.toBe(oldKey);
      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), oldKey);
      expect(first.listenerCount("exit")).toBe(0);
      startLoading(contents);
      finishLoading(contents);
      expect(first.postMessage).toHaveBeenCalledTimes(1);
      expect(second.postMessage).toHaveBeenCalledTimes(2);
   });

   it("keeps the connections of other channels and other pages apart", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const page = createContents({ id: 1 });
      const other = createContents({ id: 2 });
      const query = ipc.queryRows.connect(child, page);
      ipc.countRows.connect(child, page);
      ipc.queryRows.connect(child, other);

      expect(page.send).not.toHaveBeenCalled();
      expect(other.send).not.toHaveBeenCalled();
      query.close();

      expect(page.send).toHaveBeenCalledTimes(1);
      expect(other.send).not.toHaveBeenCalled();
      startLoading(page);
      finishLoading(page);
      expect(page.postMessage).toHaveBeenCalledTimes(3);
   });

   it("throws for contents which are destroyed already, and registers nothing", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      contents.destroyed = true;

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("Object has been destroyed");

      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(child.postMessage).not.toHaveBeenCalled();
   });

   it("undoes the connection and closes both ports when the first pairing fails", async () => {
      const ipc = await loadMain();
      const child = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("the child is gone");
      });
      const contents = createContents();

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("the child is gone");

      expect(channelsMade[0].port1.close).toHaveBeenCalledTimes(1);
      expect((channelsMade[0].port2 as { close: () => void }).close).toBeDefined();
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(contents.listenerCount("did-finish-load")).toBe(0);
   });

   it("closes the ports when the page cannot be reached", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      contents.postMessage.mockImplementation(() => {
         throw new Error("no frame");
      });

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("no frame");

      expect(channelsMade[0].port1.close).toHaveBeenCalledTimes(1);
   });

   it("reports a pairing which fails on a later load, instead of throwing from the event", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      ipc.queryRows.connect(child, contents);
      child.postMessage.mockImplementation(() => {
         throw new Error("the child is gone");
      });

      startLoading(contents);
      expect(() => finishLoading(contents)).not.toThrow();

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "the child is gone" }));
   });
});

/** A `MessagePortMain` of the child: an emitter with the methods of the generated code. */
class FakeBrokerPort extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
   /** The page posts a message. */
   fromPage(data: unknown) {
      this.emit("message", { data });
   }
   /** What was posted to the page, with the given tag. */
   posted(tag?: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => tag === undefined || message.__ipc === tag);
   }
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   /** The main process posts a message to the child, with the ports it transfers. */
   const emitFromMain = (data: unknown, ports?: unknown[]) => port.emit("message", { data, ports });
   /** The main process hands a brokered port to the child. */
   const broker = (channel: string, key = "1:utility", brokerPort = new FakeBrokerPort()) => {
      emitFromMain({ __ipc: "port", channel: wire(channel), key }, [brokerPort]);
      return brokerPort;
   };
   return { port, emitFromMain, broker };
}

async function loadUtility() {
   project = await runFixture("utility-ports");
   const parent = createParentPort();
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});
   return { ...parent, ipc: utility.ipc };
}

const ok = (value: unknown) => ({ ok: true, value });
const call = (channel: string, id: number, ...args: unknown[]) => ({
   __ipc: "call",
   channel: wire(channel),
   id,
   args,
});
const startStream = (channel: string, id: number, ...args: unknown[]) => ({
   __ipc: "stream",
   channel: wire(channel),
   id,
   args,
});
const cancel = (channel: string, id: number) => ({ __ipc: "cancel", channel: wire(channel), id });

describe("utility ports, the utility process, accepting ports", () => {
   it("starts a port of a channel of the file, and ignores the messages of other channels on it", async () => {
      const { ipc, broker } = await loadUtility();
      const handler = vi.fn(async () => []);
      ipc.queryRows.handle(handler);

      const port = broker("queryRows");
      port.fromPage(call("countRows", 1, "rows"));
      await flush();

      expect(port.start).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("closes a port of a channel it does not know, and a port message without a port is left alone", async () => {
      const { ipc, broker, emitFromMain } = await loadUtility();
      ipc.queryRows.handle(async () => []);

      const unknown = broker("getUser");
      const other = broker("somethingElse");
      emitFromMain({ __ipc: "port", channel: wire("queryRows"), key: "k" });
      emitFromMain({ __ipc: "port", channel: 7, key: "k" }, [new FakeBrokerPort()]);

      expect(unknown.close).toHaveBeenCalledTimes(1);
      expect(unknown.start).not.toHaveBeenCalled();
      expect(other.close).toHaveBeenCalledTimes(1);
   });

   it("leaves the other messages of the main process to the channels between the two", async () => {
      const { ipc, emitFromMain, port } = await loadUtility();
      ipc.indexFile.handle(async (path: string) => path.length);

      emitFromMain(null);
      emitFromMain("text");
      emitFromMain(call("indexFile", 9, "abc"));
      await flush();

      expect(port.postMessage).toHaveBeenCalledWith({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: 9,
         envelope: ok(3),
      });
   });

   it("listens to the main process as soon as a handler is registered, since a port may arrive first", async () => {
      const { ipc, port } = await loadUtility();
      expect(port.listenerCount("message")).toBe(0);

      ipc.queryRows.handle(async () => []);

      expect(port.listenerCount("message")).toBe(1);
   });

   it("fails outside a utility process, like the other channels", async () => {
      project = await runFixture("utility-ports");
      const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});

      expect(() => utility.ipc.queryRows.handle(async () => [])).toThrow(TypeError);
      expect(() =>
         utility.ipc.scanRows.handle(async function* () {
            yield { id: 1, label: "x" };
         }),
      ).toThrow("only in an Electron utility process");
   });
});

describe("utility ports, the utility process, calls", () => {
   it("calls the handler with the arguments, and answers with the envelope", async () => {
      const { ipc, broker } = await loadUtility();
      const handler = vi.fn(async (sql: string, limit?: number) => [
         { id: sql.length, label: String(limit) },
      ]);
      ipc.queryRows.handle(handler);
      const port = broker("queryRows");

      port.fromPage(call("queryRows", 4, "select", 3));
      await flush();

      expect(handler).toHaveBeenCalledWith("select", 3);
      expect(port.posted("reply")).toStrictEqual([
         {
            __ipc: "reply",
            channel: wire("queryRows"),
            id: 4,
            envelope: ok([{ id: 6, label: "3" }]),
         },
      ]);
   });

   it("spreads rest arguments, and answers a handler which is not async", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.tagged.handle(async (label: string, ...tags: string[]) => `${label}:${tags.join(",")}`);
      ipc.countRows.handle((table: string) => table.length);
      const tagged = broker("tagged");
      const count = broker("countRows");

      tagged.fromPage(call("tagged", 1, "a", "b", "c"));
      count.fromPage(call("countRows", 2, "rows"));
      await flush();

      expect(tagged.posted("reply")[0].envelope).toStrictEqual(ok("a:b,c"));
      expect(count.posted("reply")[0].envelope).toStrictEqual(ok(4));
   });

   it("answers with the error that the handler threw, as name, message, code and data", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.queryRows.handle(async () => {
         throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } };
      });
      const port = broker("queryRows");

      port.fromPage(call("queryRows", 1, "x"));
      await flush();

      expect(port.posted("reply")[0].envelope).toStrictEqual({
         ok: false,
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
   });

   it("answers a call without a handler with IPC_UTILITY_NO_HANDLER, so that the page does not wait", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.scanRows.handle(async function* () {
         yield { id: 1, label: "x" };
      });
      const port = broker("queryRows");
      const streams = broker("scanRows");

      port.fromPage(call("queryRows", 1, "x"));
      // A stream handler is not a handler of calls.
      streams.fromPage(call("scanRows", 2, "rows"));
      await flush();

      expect(port.posted("reply")[0].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_NO_HANDLER" },
      });
      expect(streams.posted("reply")[0].envelope).toMatchObject({
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replaces the handler, and the disposer of a replaced handler removes nothing", async () => {
      const { ipc, broker } = await loadUtility();
      const first = vi.fn(async () => ["first"]);
      const second = vi.fn(async () => ["second"]);
      const removeFirst: () => void = ipc.queryRows.handle(first);
      const removeSecond: () => void = ipc.queryRows.handle(second);
      const port = broker("queryRows");

      removeFirst();
      port.fromPage(call("queryRows", 1, "x"));
      await flush();
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();

      removeSecond();
      port.fromPage(call("queryRows", 2, "x"));
      await flush();
      expect(port.posted("reply")[1].envelope).toMatchObject({
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replaces the answer with an error when the value cannot be sent", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.queryRows.handle(async () => [{ id: 1, label: "x" }]);
      const port = broker("queryRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      port.fromPage(call("queryRows", 1, "x"));
      await flush();

      // The first attempt threw, and the second one carries the error.
      expect(port.posted("reply")).toHaveLength(2);
      expect(port.posted("reply")[1].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" },
      });
      expect(port.posted("reply")[1].envelope.error.message).toContain("could not be cloned");
   });

   it("ignores messages of an unknown shape, and answers none after the port closed", async () => {
      const { ipc, broker } = await loadUtility();
      let finish: (value: unknown[]) => void = () => undefined;
      ipc.queryRows.handle(() => new Promise<unknown[]>((resolve) => (finish = resolve)));
      const port = broker("queryRows");

      for (const junk of [null, "text", 7, [], {}, { __ipc: "call" }, { __ipc: "stream" }]) {
         port.fromPage(junk);
      }
      port.fromPage({ ...call("queryRows", 1, "x"), args: "not a list" });
      port.fromPage({ ...startStream("queryRows", "1" as unknown as number), args: [] });
      port.fromPage(call("queryRows", 2, "x"));
      port.emit("close");
      finish([]);
      await flush();

      expect(port.postMessage).not.toHaveBeenCalled();
   });
});

describe("utility ports, the utility process, streams", () => {
   it("pumps the chunks in order, then the end, and does not stop an iterator which ended", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      const handler = vi.fn(() => source.iterable);
      ipc.scanRows.handle(handler);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 5, "rows"));
      await flush();
      expect(handler).toHaveBeenCalledWith("rows");
      source.push({ id: 1 });
      source.push({ id: 2 });
      source.end();
      await flush();
      await flush();

      expect(port.postMessage.mock.calls.map(([message]) => message)).toStrictEqual([
         { __ipc: "chunk", channel: wire("scanRows"), id: 5, value: { id: 1 } },
         { __ipc: "chunk", channel: wire("scanRows"), id: 5, value: { id: 2 } },
         { __ipc: "end", channel: wire("scanRows"), id: 5 },
      ]);
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("serves an async generator, and several streams of one port by their IDs", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.counter.handle(async function* () {
         yield 1;
         yield 2;
      });
      const port = broker("counter");

      port.fromPage(startStream("counter", 1));
      port.fromPage(startStream("counter", 2));
      await settle();

      const byId = (id: number) => port.posted().filter((message) => message.id === id);
      for (const id of [1, 2]) {
         expect(byId(id).map((message) => message.__ipc)).toStrictEqual(["chunk", "chunk", "end"]);
         expect(byId(id).map((message) => message.value)).toStrictEqual([1, 2, undefined]);
      }
   });

   it("fails the stream with the error of the generator, and with the one of a handler which throws", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      ipc.counter.handle(() => {
         throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } };
      });
      const rows = broker("scanRows");
      const counter = broker("counter");

      rows.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      source.push({ id: 1 });
      source.fail(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
      counter.fromPage(startStream("counter", 2));
      await settle();

      expect(rows.posted().map((message) => message.__ipc)).toStrictEqual(["chunk", "error"]);
      expect(rows.posted("error")[0]).toStrictEqual({
         __ipc: "error",
         channel: wire("scanRows"),
         id: 1,
         error: { name: "Error", message: "disk full", code: "ENOSPC" },
      });
      expect(counter.posted("error")[0].error).toStrictEqual({
         name: "QueryError",
         message: "no table",
         code: "E_QUERY",
         data: { sql: "x" },
      });
   });

   it("fails a stream whose handler has no handler, returns no iterable, or rejects", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.scanRows.handle((() => ({ not: "iterable" })) as never);
      ipc.counter.handle((async () => {
         throw new Error("rejected");
      }) as never);
      const rows = broker("scanRows");
      const counter = broker("counter");
      const missing = broker("streamForm");
      // A call handler is not a stream handler.
      ipc.queryRows.handle(async () => []);
      const query = broker("queryRows");

      rows.fromPage(startStream("scanRows", 1, "rows"));
      counter.fromPage(startStream("counter", 2));
      missing.fromPage(startStream("streamForm", 3, "seed"));
      query.fromPage(startStream("queryRows", 4, "x"));
      await settle();

      expect(rows.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NOT_ITERABLE" });
      expect(counter.posted("error")[0].error).toMatchObject({ message: "rejected" });
      expect(missing.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NO_HANDLER" });
      expect(query.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NO_HANDLER" });
   });

   it("stops the iterator once when the page cancels, and sends no chunk after it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      source.push({ id: 1 });
      await flush();

      port.fromPage(cancel("scanRows", 1));
      port.fromPage(cancel("scanRows", 1));
      port.fromPage(cancel("scanRows", 99));
      source.push({ id: 2 });
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(port.posted("chunk")).toHaveLength(1);
      expect(port.posted("error")).toHaveLength(0);
   });

   it("says nothing about an error which arrives after the cancel", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();

      port.fromPage(cancel("scanRows", 1));
      source.fail(new Error("late"));
      await settle();

      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops a stream which is cancelled while the handler is starting, without reading it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (open = resolve));
      ipc.scanRows.handle((async () => {
         await gate;
         return source.iterable;
      }) as never);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.fromPage(cancel("scanRows", 1));
      open();
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(source.iterator.next).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("says nothing about an error of a handler which was cancelled while it started", async () => {
      const { ipc, broker } = await loadUtility();
      let reject: (error: unknown) => void = () => undefined;
      const gate = new Promise<never>((_resolve, fail) => (reject = fail));
      ipc.scanRows.handle((async () => gate) as never);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.fromPage(cancel("scanRows", 1));
      reject(new Error("late"));
      await settle();

      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops every open stream when the port closes, and sends nothing afterwards", async () => {
      const { ipc, broker } = await loadUtility();
      const rows = createSource();
      const counter = createSource();
      ipc.scanRows.handle(() => rows.iterable);
      ipc.counter.handle(() => counter.iterable as never);
      const port = broker("scanRows");
      const other = broker("counter");
      port.fromPage(startStream("scanRows", 1, "rows"));
      port.fromPage(startStream("scanRows", 2, "rows"));
      other.fromPage(startStream("counter", 1));
      await flush();

      port.emit("close");
      rows.push({ id: 1 });
      rows.push({ id: 2 });
      await settle();

      // Both streams of the port read from the same source here, so the one stop each is enough.
      expect(rows.iterator.return).toHaveBeenCalledTimes(2);
      expect(counter.iterator.return).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops the iterator and fails the stream when a chunk cannot be sent", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      source.push(() => undefined);
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(port.posted("error")[0].error).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_UNSENDABLE",
      });
      expect(port.posted("error")[0].error.message).toContain("could not be cloned");
   });

   it("ignores a second start with the ID of a stream which is open", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      const handler = vi.fn(() => source.iterable);
      ipc.scanRows.handle(handler);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      port.fromPage(startStream("scanRows", 1, "again"));
      await flush();

      expect(handler).toHaveBeenCalledTimes(1);
   });

   it("reports what cannot be told to the page, instead of throwing", async () => {
      const { ipc, broker } = await loadUtility();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const ending = createSource();
      const failing = createSource();
      const stopping = createSource();
      stopping.iterator.return.mockRejectedValue(new Error("return failed"));
      ipc.scanRows.handle(() => ending.iterable);
      ipc.counter.handle(() => failing.iterable as never);
      ipc.streamForm.handle(() => stopping.iterable as never);
      const rows = broker("scanRows");
      const counter = broker("counter");
      const form = broker("streamForm");
      rows.postMessage.mockImplementation(() => {
         throw new Error("port is gone");
      });
      counter.postMessage.mockImplementation(() => {
         throw new Error("port is gone");
      });
      rows.fromPage(startStream("scanRows", 1, "rows"));
      counter.fromPage(startStream("counter", 1));
      form.fromPage(startStream("streamForm", 1, "seed"));
      await flush();

      ending.end();
      failing.fail(new Error("broken"));
      form.fromPage(cancel("streamForm", 1));
      await settle();

      const messages = error.mock.calls.map(([value]) => (value as Error).message);
      expect(messages.filter((message) => message === "port is gone")).toHaveLength(2);
      expect(messages).toContain("return failed");
   });

   it("reports an iterator which cannot be stopped, and a failing stop of a closed port", async () => {
      const { ipc, broker } = await loadUtility();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const source = createSource();
      source.iterator.return.mockImplementation(() => {
         throw new Error("return threw");
      });
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();

      port.emit("close");

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "return threw" }));
   });
});

/** A `MessagePort` of the page: records what is posted, and delivers what the test says. */
class FakePagePort {
   onmessage: ((event: { data: unknown }) => void) | null = null;
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   /** The child posts a message to the page. */
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
   /** What the page posted to the child, with the given tag. */
   posted(tag: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => message.__ipc === tag);
   }
}

async function loadPage() {
   project = await runFixture("utility-ports");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (channel: string) => {
      const found = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      if (!found) {
         throw new Error(`The preload script does not listen on '${channel}'`);
      }
      return found[1] as (event: unknown, key: unknown) => void;
   };
   /** Hands a port to the page, the way the main process does. */
   const arrive = (
      name: string,
      key: unknown = "1:utility",
      port: FakePagePort | null = new FakePagePort(),
   ) => {
      listener(wire(name))({ ports: port ? [port] : [] }, key);
      return port as FakePagePort;
   };
   /** The main process tells the page that the connection has ended. */
   const closeFromMain = (name: string, key: unknown) => listener(closeWire(name))({}, key);
   return { api: fake.exposed.ipc, arrive, closeFromMain, fake };
}

/** What a promise settles with, as a plain description. */
const settled = (promise: Promise<unknown>) =>
   promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );

describe("utility ports, the page, calls", () => {
   it("waits for the port of the connection, then posts the calls in order", async () => {
      const { api, arrive } = await loadPage();

      const first = api.queryRows.invoke("select 1", 5);
      const second = api.queryRows.invoke("select 2");
      const port = arrive("queryRows");

      const [one, two] = port.posted("call");
      expect(one).toStrictEqual({
         __ipc: "call",
         channel: wire("queryRows"),
         id: expect.any(Number),
         args: ["select 1", 5],
      });
      expect(two.args).toStrictEqual(["select 2"]);
      expect(two.id).not.toBe(one.id);
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: two.id, envelope: ok(2) });
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: one.id, envelope: ok(1) });
      await expect(first).resolves.toBe(1);
      await expect(second).resolves.toBe(2);
   });

   it("posts a call at once when the port is there, spreads rest arguments, and sends none for no parameters", async () => {
      const { api, arrive } = await loadPage();
      const tagged = arrive("tagged");
      const ping = arrive("ping");

      api.tagged.invoke("a", "b", "c");
      api.ping.invoke();

      expect(tagged.posted("call")[0].args).toStrictEqual(["a", "b", "c"]);
      expect(ping.posted("call")[0].args).toStrictEqual([]);
   });

   it("rejects with the error of the handler as a plain object", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");

      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");
      port.deliver({
         __ipc: "reply",
         channel: wire("queryRows"),
         id: sent.id,
         envelope: {
            ok: false,
            error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
         },
      });

      const result = await settled(answer);
      expect(Object.getPrototypeOf((result as { error: object }).error)).toBe(Object.prototype);
      expect(result).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
   });

   it.each([
      ["a missing envelope", undefined],
      ["an envelope that is not an object", "yes"],
      ["an envelope of an unknown shape", { ok: "maybe" }],
      ["a failure without an error", { ok: false }],
   ])("rejects with IPC_UTILITY_INVALID_REPLY for %s", async (_name, envelope) => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");

      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope });

      expect(await settled(answer)).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_INVALID_REPLY" },
      });
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be sent, and keeps working", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      const result = await settled(api.queryRows.invoke("x"));

      expect(result).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" },
      });
      expect((result as { error: Error }).error.message).toContain("could not be cloned");
      api.queryRows.invoke("y");
      expect(port.posted("call")).toHaveLength(2);
   });

   it("ignores replies it cannot trust, and keeps waiting", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");

      for (const message of [
         null,
         "text",
         [],
         { __ipc: "reply", channel: wire("countRows"), id: sent.id, envelope: ok(0) },
         { __ipc: "reply", channel: wire("queryRows"), id: sent.id + 100, envelope: ok(0) },
         { __ipc: "reply", channel: wire("queryRows"), id: String(sent.id), envelope: ok(0) },
         { __ipc: "other", channel: wire("queryRows"), id: sent.id },
      ]) {
         port.deliver(message);
      }
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(7) });

      await expect(answer).resolves.toBe(7);
   });

   it("settles a call once: a second reply with its ID is dropped", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");

      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(1) });
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(2) });

      await expect(answer).resolves.toBe(1);
   });
});

describe("utility ports, the page, the life of the connection", () => {
   it("rejects the open calls with IPC_UTILITY_EXITED when the port closes, and the later calls at once", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const open = api.queryRows.invoke("x");

      port.emitClose();

      expect(await settled(open)).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
      });
      expect(port.close).toHaveBeenCalledTimes(1);
      expect(await settled(api.queryRows.invoke("y"))).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });
      expect(port.postMessage).toHaveBeenCalledTimes(1);
   });

   it("ends the connection when the main process says so with the key, and ignores any other key", async () => {
      const { api, arrive, closeFromMain } = await loadPage();
      const port = arrive("queryRows", "7:utility");
      const open = api.queryRows.invoke("x");

      closeFromMain("queryRows", "8:utility");
      closeFromMain("queryRows", 7);
      expect(port.close).not.toHaveBeenCalled();

      closeFromMain("queryRows", "7:utility");
      expect(await settled(open)).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(port.close).toHaveBeenCalledTimes(1);
      closeFromMain("queryRows", "7:utility");
      expect(port.close).toHaveBeenCalledTimes(1);
   });

   it("works again when the main process connects a new process, after the old one went away", async () => {
      const { api, arrive } = await loadPage();
      const old = arrive("queryRows", "1:utility");
      old.emitClose();
      expect(await settled(api.queryRows.invoke("x"))).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });

      const fresh = arrive("queryRows", "2:utility");
      const answer = api.queryRows.invoke("y");
      const [sent] = fresh.posted("call");
      fresh.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(3) });

      await expect(answer).resolves.toBe(3);
   });

   it("replaces the port of the channel: the open calls of the old one fail, and the old port is closed", async () => {
      const { api, arrive } = await loadPage();
      const old = arrive("queryRows", "1:utility");
      const open = api.queryRows.invoke("x");

      const fresh = arrive("queryRows", "1:utility");

      expect(await settled(open)).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(old.close).toHaveBeenCalledTimes(1);
      // The old port can no longer fail the connection of the new one.
      old.emitClose();
      const answer = api.queryRows.invoke("y");
      const [sent] = fresh.posted("call");
      fresh.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(1) });
      await expect(answer).resolves.toBe(1);
   });

   it("keeps the channels apart, and closes a port which has no usable key", async () => {
      const { api, arrive } = await loadPage();
      const query = arrive("queryRows");
      const count = arrive("countRows");
      const bad = arrive("ping", 5);
      arrive("tagged", "k", null);

      query.emitClose();
      api.countRows.invoke("rows");

      expect(count.posted("call")).toHaveLength(1);
      expect(bad.close).toHaveBeenCalledTimes(1);
   });
});

describe("utility ports, the page, streams", () => {
   const chunk = (name: string, id: number, value: unknown) => ({
      __ipc: "chunk",
      channel: wire(name),
      id,
      value,
   });
   const end = (name: string, id: number) => ({ __ipc: "end", channel: wire(name), id });
   const failure = (name: string, id: number, error: unknown) => ({
      __ipc: "error",
      channel: wire(name),
      id,
      error,
   });

   it("waits for the port, posts the start with the arguments, and reads the chunks in order", async () => {
      const { api, arrive } = await loadPage();

      const stream = api.scanRows.stream("rows");
      const port = arrive("scanRows");

      const [start] = port.posted("stream");
      expect(start).toStrictEqual({
         __ipc: "stream",
         channel: wire("scanRows"),
         id: expect.any(Number),
         args: ["rows"],
      });
      const reads = [stream.next(), stream.next(), stream.next()];
      port.deliver(chunk("scanRows", start.id, { id: 1 }));
      port.deliver(chunk("scanRows", start.id, { id: 2 }));
      port.deliver(end("scanRows", start.id));
      expect(await Promise.all(reads)).toStrictEqual([
         { done: false, value: { id: 1 } },
         { done: false, value: { id: 2 } },
         { done: true, value: undefined },
      ]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("is an async iterable, and keeps the streams of one port apart by their IDs", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("counter");
      const one = api.counter.stream();
      const two = api.counter.stream();
      const [first, second] = port.posted("stream");

      port.deliver(chunk("counter", second.id, "b"));
      port.deliver(chunk("counter", first.id, "a"));
      port.deliver(end("counter", first.id));
      port.deliver(end("counter", second.id));

      const read = async (stream: AsyncIterable<unknown>) => {
         const chunks: unknown[] = [];
         for await (const item of stream) {
            chunks.push(item);
         }
         return chunks;
      };
      expect(await read(one)).toStrictEqual(["a"]);
      expect(await read(two)).toStrictEqual(["b"]);
   });

   it("fails a read with the error of the stream, as a plain object, after the chunks that were queued", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");

      port.deliver(chunk("scanRows", start.id, 1));
      port.deliver(
         failure("scanRows", start.id, {
            name: "QueryError",
            message: "no table",
            code: "E_QUERY",
            data: { sql: "x" },
         }),
      );

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settled(stream.next())).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("cancels in the child with the ID, drops what was queued, and ends the stream", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");
      port.deliver(chunk("scanRows", start.id, 1));

      stream.cancel();
      stream.cancel();
      port.deliver(chunk("scanRows", start.id, 2));

      expect(port.posted("cancel")).toStrictEqual([
         { __ipc: "cancel", channel: wire("scanRows"), id: start.id },
      ]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("cancels with return(), which a break calls, and does not touch the other streams", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("counter");
      const one = api.counter.stream();
      const two = api.counter.stream();
      const [first, second] = port.posted("stream");

      expect(await one.return()).toStrictEqual({ done: true, value: undefined });

      expect(port.posted("cancel").map((message) => message.id)).toStrictEqual([first.id]);
      port.deliver(chunk("counter", second.id, 5));
      expect(await two.next()).toStrictEqual({ done: false, value: 5 });
   });

   it("never starts a stream which is cancelled while it waits for the port", async () => {
      const { api, arrive } = await loadPage();
      const stream = api.scanRows.stream("rows");

      stream.cancel();
      const port = arrive("scanRows");

      expect(port.postMessage).not.toHaveBeenCalled();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails the streams that are open when the port closes, with IPC_UTILITY_EXITED", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");

      port.emitClose();

      expect(await settled(stream.next())).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
      });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails a stream which is started after the connection closed, at the first read", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      port.emitClose();

      const stream = api.scanRows.stream("rows");

      expect(await settled(stream.next())).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(port.posted("stream")).toHaveLength(0);
   });

   it("fails the stream when its start cannot be sent", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      const stream = api.scanRows.stream("rows");

      const result = await settled(stream.next());
      expect(result).toMatchObject({ error: { code: "IPC_UTILITY_UNSENDABLE" } });
      expect((result as { error: Error }).error.message).toContain("could not be cloned");
   });

   it("ignores messages for another channel, another ID or of an unknown shape", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");

      for (const message of [
         null,
         "text",
         chunk("counter", start.id, "other channel"),
         chunk("scanRows", start.id + 100, "other id"),
         { __ipc: "unknown", channel: wire("scanRows"), id: start.id },
      ]) {
         port.deliver(message);
      }
      port.deliver(chunk("scanRows", start.id, "mine"));

      expect(await stream.next()).toStrictEqual({ done: false, value: "mine" });
   });
});

/** A `MessagePortMain` on top of a real `MessagePort`, so that the ports really carry messages. */
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

class RealChannelMain {
   port1: RealPortMain;
   port2: MessagePort;
   constructor() {
      const channel = new MessageChannel();
      this.port1 = new RealPortMain(channel.port1);
      this.port2 = channel.port2;
      rawPorts.push(channel.port2);
   }
}

/** The three generated scripts, wired to each other the way Electron does for one page and one child. */
async function loadAll() {
   project = await runFixture("utility-ports");
   const electron = { ...createFakeElectron(), MessageChannelMain: RealChannelMain };
   const main = loadGenerated(project.generated["main.ts"], { electron }).ipc;
   const parent = createParentPort();
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {}).ipc;
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (channel: string) =>
      fake.electron.ipcRenderer.on.mock.calls.find(([name]: [string]) => name === channel)?.[1] as (
         event: unknown,
         key: unknown,
      ) => void;

   const child = createChild();
   child.postMessage.mockImplementation((message: unknown, ports?: unknown[]) =>
      parent.emitFromMain(message, ports),
   );
   const contents = createContents();
   contents.postMessage.mockImplementation((channel: string, key: unknown, ports: unknown[]) =>
      listener(channel)({ ports }, key),
   );
   contents.send.mockImplementation((channel: string, key: unknown) => listener(channel)({}, key));
   return { main, utility, page: fake.exposed.ipc, child, contents };
}

describe("utility ports, the three scripts together over real ports", () => {
   it("calls the handler of the child from the page, with the errors of the handler", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.queryRows.handle(async (sql: string, limit?: number) => {
         if (sql === "bad") {
            throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql } };
         }
         return [{ id: sql.length, label: String(limit) }];
      });
      main.queryRows.connect(child, contents);

      expect(await page.queryRows.invoke("select", 2)).toStrictEqual([{ id: 6, label: "2" }]);
      expect(await settled(page.queryRows.invoke("bad"))).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "bad" } },
      });
   });

   it("holds a call which is made before the main process connects, and sends it afterwards", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.countRows.handle((table: string) => table.length);

      const early = page.countRows.invoke("rows");
      await settle();
      main.countRows.connect(child, contents);

      expect(await early).toBe(4);
   });

   it("streams from the child to the page, and cancels it", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let stopped = 0;
      utility.scanRows.handle(async function* (table: string) {
         try {
            for (let id = 1; ; id++) {
               yield { id, label: `${table}-${id}` };
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a row at a time
               await settle();
            }
         } finally {
            stopped += 1;
         }
      });
      utility.counter.handle(async function* () {
         yield 1;
         yield 2;
      });
      main.scanRows.connect(child, contents);
      main.counter.connect(child, contents);

      const rows: unknown[] = [];
      for await (const row of page.scanRows.stream("t")) {
         rows.push(row);
         if (rows.length === 2) {
            break;
         }
      }
      await settle();
      const counted: number[] = [];
      for await (const value of page.counter.stream()) {
         counted.push(value);
      }

      expect(rows).toStrictEqual([
         { id: 1, label: "t-1" },
         { id: 2, label: "t-2" },
      ]);
      expect(stopped).toBe(1);
      expect(counted).toStrictEqual([1, 2]);
   });

   it("fails the page when the main process closes the connection, and the child stops the stream", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let stopped = 0;
      utility.scanRows.handle(async function* () {
         try {
            for (;;) {
               yield 1;
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a value at a time
               await settle();
            }
         } finally {
            stopped += 1;
         }
      });
      const link = main.scanRows.connect(child, contents);
      const stream = page.scanRows.stream("t");
      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });

      link.close();

      expect(await settled(stream.next())).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      await settle();
      expect(stopped).toBe(1);
      expect(await settled(page.scanRows.stream("t").next())).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });
   });

   it("gives a page that reloads a fresh port, and keeps the child's handlers", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.countRows.handle((table: string) => table.length);
      main.countRows.connect(child, contents);
      expect(await page.countRows.invoke("rows")).toBe(4);

      startLoading(contents);
      finishLoading(contents);

      expect(await page.countRows.invoke("rows!")).toBe(5);
   });
});

describe("utility ports, the utility process, flow control", () => {
   const credit = (channel: string, id: number, limit: unknown) => ({
      __ipc: "credit",
      channel: wire(channel),
      id,
      limit,
   });
   const upTo = (count: number) => Array.from({ length: count }, (_, value) => value);
   const fill = (source: ReturnType<typeof createSource>, count: number) => {
      for (const value of upTo(count)) {
         source.push(value);
      }
   };
   /** The values of the chunks of one call that were sent to the page. */
   const sentValues = (port: FakeBrokerPort, id: number) =>
      port
         .posted("chunk")
         .filter((message) => message.id === id)
         .map((message) => message.value);

   it("stops pulling from the generator at the window of the channel, and goes on when the page grants more", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");

      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 10);
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(source.iterator.next).toHaveBeenCalledTimes(4);

      port.fromPage(credit("windowedRows", 1, 6));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(6));

      port.fromPage(credit("windowedRows", 1, 100));
      source.end();
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(10));
      expect(port.posted("end")).toHaveLength(1);
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("gives every call a window of its own on the shared port", async () => {
      const { ipc, broker } = await loadUtility();
      const sources = [createSource(), createSource()];
      let opened = 0;
      ipc.windowedRows.handle(() => sources[opened++].iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      port.fromPage(startStream("windowedRows", 2));
      await flush();
      fill(sources[0], 10);
      fill(sources[1], 10);
      await settle();

      port.fromPage(credit("windowedRows", 2, 7));
      port.fromPage(credit("windowedRows", 99, 7));
      port.fromPage(credit("pulledRows", 1, 7));
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(sentValues(port, 2)).toStrictEqual(upTo(7));
   });

   it("uses a window of 1024 chunks when the channel sets none, and never pauses an infinite one", async () => {
      const { ipc, broker } = await loadUtility();
      const standard = createSource();
      const unbounded = createSource();
      ipc.counter.handle(() => standard.iterable as never);
      ipc.unboundedRows.handle(() => unbounded.iterable);
      const counter = broker("counter");
      const rows = broker("unboundedRows");
      counter.fromPage(startStream("counter", 1));
      rows.fromPage(startStream("unboundedRows", 1));
      await flush();

      fill(standard, 1500);
      fill(unbounded, 3000);
      unbounded.end();
      await settle();

      expect(sentValues(counter, 1)).toHaveLength(1024);
      expect(sentValues(rows, 1)).toStrictEqual(upTo(3000));
      expect(rows.posted("end")).toHaveLength(1);
   });

   it("pulls only what the page grants when the window is 0", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.pulledRows.handle(() => source.iterable);
      const port = broker("pulledRows");
      port.fromPage(startStream("pulledRows", 1));
      await flush();
      fill(source, 3);
      await settle();
      expect(source.iterator.next).not.toHaveBeenCalled();

      port.fromPage(credit("pulledRows", 1, 1));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual([0]);

      port.fromPage(credit("pulledRows", 1, 3));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual([0, 1, 2]);
   });

   it("ignores a credit which does not raise the limit, or is not a number", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 10);
      await settle();

      for (const limit of [4, 3, -1, "9", Number.NaN, null, undefined, {}, true]) {
         port.fromPage(credit("windowedRows", 1, limit));
      }
      port.fromPage({ __ipc: "credit", channel: wire("windowedRows"), id: "1", limit: 9 });
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
   });

   it("cancels a paused stream at once, and ignores a credit which comes after", async () => {
      const { ipc, broker } = await loadUtility();
      let produced = 0;
      let finalized = 0;
      ipc.windowedRows.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               produced += 1;
               yield n;
            }
         } finally {
            finalized += 1;
         }
      });
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await settle();
      expect(produced).toBe(4);

      port.fromPage(cancel("windowedRows", 1));
      await settle();
      port.fromPage(credit("windowedRows", 1, 50));
      await settle();

      expect(finalized).toBe(1);
      expect(produced).toBe(4);
      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(port.posted("end")).toHaveLength(0);
      expect(port.posted("error")).toHaveLength(0);
   });

   it("stops every paused stream when the port closes", async () => {
      const { ipc, broker } = await loadUtility();
      const sources = [createSource(), createSource()];
      let opened = 0;
      ipc.windowedRows.handle(() => sources[opened++].iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      port.fromPage(startStream("windowedRows", 2));
      await flush();
      fill(sources[0], 10);
      fill(sources[1], 10);
      await settle();

      port.emit("close");
      await settle();

      for (const source of sources) {
         expect(source.iterator.return).toHaveBeenCalledOnce();
         expect(source.iterator.next).toHaveBeenCalledTimes(4);
      }
   });

   it("sends the error of the generator after the chunks, once the page has granted the pull that finds it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 4);
      source.fail({ name: "Boom", message: "exploded", code: "E1" });
      await settle();
      expect(port.posted("error")).toHaveLength(0);

      port.fromPage(credit("windowedRows", 1, 5));
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(port.posted("error")).toStrictEqual([
         {
            __ipc: "error",
            channel: wire("windowedRows"),
            id: 1,
            error: { name: "Boom", message: "exploded", code: "E1" },
         },
      ]);
   });
});

describe("utility ports, the page, flow control", () => {
   const credits = (port: FakePagePort) =>
      port.posted("credit").map((message) => ({ id: message.id, limit: message.limit }));
   const chunks = (port: FakePagePort, name: string, id: number, count: number) => {
      for (let n = 0; n < count; n++) {
         port.deliver({ __ipc: "chunk", channel: wire(name), id, value: n });
      }
   };

   it("grants more once half of the window is read, as a total", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("windowedRows");
      const stream = api.windowedRows.stream();
      const [start] = port.posted("stream");
      chunks(port, "windowedRows", start.id, 4);

      await stream.next();
      expect(credits(port)).toStrictEqual([]);
      await stream.next();
      expect(credits(port)).toStrictEqual([{ id: start.id, limit: 6 }]);
      await stream.next();
      await stream.next();
      expect(credits(port)).toStrictEqual([
         { id: start.id, limit: 6 },
         { id: start.id, limit: 8 },
      ]);
      expect(port.posted("credit")[0].channel).toBe(wire("windowedRows"));
   });

   it("grants the reads which wait only after the stream is started, when the window is 0", async () => {
      const { api, arrive } = await loadPage();
      const stream = api.pulledRows.stream();
      const first = stream.next();
      const port = arrive("pulledRows");
      const [start] = port.posted("stream");
      expect(credits(port)).toStrictEqual([{ id: start.id, limit: 1 }]);

      chunks(port, "pulledRows", start.id, 1);
      expect(await first).toStrictEqual({ done: false, value: 0 });
      const second = stream.next();
      expect(credits(port)).toStrictEqual([
         { id: start.id, limit: 1 },
         { id: start.id, limit: 2 },
      ]);
      port.deliver({ __ipc: "end", channel: wire("pulledRows"), id: start.id });
      expect(await second).toStrictEqual({ done: true, value: undefined });
   });

   it("grants nothing before the stream is started, nor on an infinite window", async () => {
      const { api, arrive } = await loadPage();
      const early = api.windowedRows.stream();
      const unbounded = api.unboundedRows.stream();
      const port = arrive("windowedRows");
      const other = arrive("unboundedRows");
      const [start] = other.posted("stream");
      chunks(other, "unboundedRows", start.id, 100);

      for (let read = 0; read < 100; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
      }

      expect(credits(other)).toStrictEqual([]);
      expect(credits(port)).toStrictEqual([]);
      early.cancel();
   });

   it("grants nothing for another call, and nothing after the end", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("windowedRows");
      const one = api.windowedRows.stream();
      const two = api.windowedRows.stream();
      const [first, second] = port.posted("stream");
      chunks(port, "windowedRows", first.id, 2);
      chunks(port, "windowedRows", second.id, 4);
      port.deliver({ __ipc: "end", channel: wire("windowedRows"), id: first.id });

      await one.next();
      await one.next();
      await two.next();
      await two.next();

      expect(credits(port)).toStrictEqual([{ id: second.id, limit: 6 }]);
   });
});

describe("utility ports, the three scripts together, flow control", () => {
   it("keeps a fast generator in the child within the window of a reader which stopped reading", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      const state = { produced: 0, finalized: false };
      utility.windowedRows.handle(async function* () {
         try {
            for (;;) {
               state.produced += 1;
               yield state.produced;
            }
         } finally {
            state.finalized = true;
         }
      });
      main.windowedRows.connect(child, contents);

      const stream = page.windowedRows.stream();
      for (let read = 0; read < 3; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await stream.next();
      }
      await settle();
      await settle();

      expect(state.produced).toBeGreaterThanOrEqual(4);
      expect(state.produced).toBeLessThanOrEqual(3 + 4);
      const paused = state.produced;
      await settle();
      expect(state.produced).toBe(paused);

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("reads every chunk in order through many pauses, and produces a chunk at a time when the window is 0", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let produced = 0;
      utility.windowedRows.handle(async function* () {
         for (let n = 0; n < 200; n++) {
            yield n;
         }
      });
      utility.pulledRows.handle(async function* () {
         for (;;) {
            produced += 1;
            yield produced;
         }
      });
      main.windowedRows.connect(child, contents);
      main.pulledRows.connect(child, contents);

      const seen: number[] = [];
      for await (const n of page.windowedRows.stream()) {
         seen.push(n);
      }
      const pulled = page.pulledRows.stream();
      for (let read = 1; read <= 4; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         expect(await pulled.next()).toStrictEqual({ done: false, value: read });
         await settle();
         expect(produced).toBe(read);
      }
      pulled.cancel();

      expect(seen).toStrictEqual(Array.from({ length: 200 }, (_, n) => n));
   });
});
