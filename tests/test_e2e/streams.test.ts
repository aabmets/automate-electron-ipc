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

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   createSource,
   loadGenerated,
   settlePorts,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const portWire = (name: string) => `autoipc:${name}:port`;

let project: E2EProject | undefined;
const rawPorts: MessagePort[] = [];

afterEach(async () => {
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
});

/** Lets the promises and the events of the real ports run. */
const settle = () => settlePorts(20);

/** A WebContents stand-in: an emitter that announces its end, as the real one does. */
function createContents(id = 1) {
   const contents = Object.assign(new EventEmitter(), {
      id,
      postMessage: vi.fn(),
      isDestroyed: () => false,
   });
   return contents;
}
type FakeContents = ReturnType<typeof createContents>;

/** A WebFrameMain stand-in, which can be told to be destroyed or detached. */
function createFrame(state: { origin?: string; destroyed?: boolean; detached?: boolean } = {}) {
   return {
      origin: state.origin ?? "app://.",
      detached: state.detached ?? false,
      postMessage: vi.fn(),
      isDestroyed: () => state.destroyed ?? false,
   };
}

/** The event of a call, as `ipcMain.handle` gives it to the handler. */
function createEvent(sender: FakeContents, frame: object | null = createFrame()) {
   return { sender, senderFrame: frame };
}

/** A `MessagePortMain`: an emitter with the methods of the generated code, and records of them. */
class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

/** The channels the generated main process made, in order. */
const channelsMade: { port1: FakePortMain; port2: object }[] = [];

class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = { name: `port2 of ${channelsMade.length + 1}` };
   constructor() {
      channelsMade.push(this);
   }
}

async function loadMainWith(channelClass: unknown, fixture = "stream-channels") {
   project = await runFixture(fixture);
   channelsMade.length = 0;
   const electron = {
      ...createFakeElectron(),
      MessageChannelMain: channelClass,
      webContents: { getAllWebContents: vi.fn(() => []), fromFrame: vi.fn() },
   };
   // The hand-written schema of the fixture, which the generated code imports.
   const countArgs = {
      "~standard": {
         version: 1,
         vendor: "test",
         validate: (value: unknown) =>
            Array.isArray(value) && value.length === 1 && typeof value[0] === "number"
               ? { value: [value[0]] }
               : { issues: [{ message: "expected one number" }] },
      },
   };
   const generated = loadGenerated(project.generated["main.ts"], {
      electron,
      "./validators": { __esModule: true, countArgs },
   });
   /** The function that `ipcMain.handle` was last given for the channel. */
   const listener = (name: string) => {
      const calls = electron.ipcMain.handle.mock.calls.filter(([w]: [string]) => w === wire(name));
      return calls.at(-1)?.[1] as (event: unknown, ...args: unknown[]) => Promise<any>;
   };
   return { ...generated, electron, listener };
}

const loadMain = () => loadMainWith(FakeChannelMain);

const lastChannel = () => channelsMade[channelsMade.length - 1];
/** What the main process posted to the page over the port of the last call. */
const posted = () => lastChannel().port1.postMessage.mock.calls.map(([message]) => message);
/** Delivers a message from the page to the main port, the way Electron does. */
const fromPage = (data: unknown) => lastChannel().port1.emit("message", { data });

/** Registers a source as the handler of a channel and starts a call, as the page would. */
async function start(
   context: Awaited<ReturnType<typeof loadMain>>,
   name: string,
   options: { id?: unknown; args?: unknown[]; contents?: FakeContents; frame?: object | null } = {},
) {
   const source = createSource();
   const handler = vi.fn(() => source.iterable);
   context.ipc[name].handle(handler);
   const contents = options.contents ?? createContents();
   const frame = options.frame === undefined ? createFrame() : options.frame;
   const envelope = await context.listener(name)(
      createEvent(contents, frame),
      options.id ?? 7,
      ...(options.args ?? []),
   );
   return { source, handler, contents, frame: frame as ReturnType<typeof createFrame>, envelope };
}

describe("stream, main process, starting a call", () => {
   it("registers a handler for the channel, which gets the event and the arguments but not the ID", async () => {
      const context = await loadMain();
      const { handler, envelope, contents } = await start(context, "exportRows", {
         args: ["people", 3],
      });

      expect(context.electron.ipcMain.handle).toHaveBeenCalledWith(
         wire("exportRows"),
         expect.any(Function),
      );
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
         expect.objectContaining({ sender: contents }),
         "people",
         3,
      );
      expect(envelope).toStrictEqual({ ok: true, value: undefined });
   });

   it("hands one port of a new channel to the frame that asked, with the ID of the call", async () => {
      const context = await loadMain();
      const { frame, contents } = await start(context, "counter", { id: 42 });

      expect(channelsMade).toHaveLength(1);
      expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(portWire("counter"), 42, [
         lastChannel().port2,
      ]);
      expect(contents.postMessage).not.toHaveBeenCalled();
      expect(lastChannel().port1.start).toHaveBeenCalledOnce();
   });

   it("falls back to the contents when the frame is gone", async () => {
      const context = await loadMain();
      for (const frame of [
         null,
         createFrame({ destroyed: true }),
         createFrame({ detached: true }),
      ]) {
         const contents = createContents();
         // biome-ignore lint/performance/noAwaitInLoops: each case starts its own call
         await start(context, "counter", { id: 5, contents, frame });

         expect(contents.postMessage).toHaveBeenCalledExactlyOnceWith(portWire("counter"), 5, [
            lastChannel().port2,
         ]);
         if (frame) {
            expect(frame.postMessage).not.toHaveBeenCalled();
         }
      }
   });

   it("gives every call a channel of its own", async () => {
      const context = await loadMain();
      await start(context, "counter", { id: 1 });
      const first = lastChannel();
      await start(context, "counter", { id: 2 });

      expect(channelsMade).toHaveLength(2);
      expect(lastChannel()).not.toBe(first);
   });

   it("answers a call without a numeric ID with an error, and runs nothing", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "counter", { id: "7" });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({
            name: "IpcStreamError",
            code: "IPC_STREAM_INVALID_REQUEST",
         }),
      });
   });

   it("answers a handler which returns no async iterable with an error and makes no channel", async () => {
      const context = await loadMain();
      context.ipc.counter.handle(() => undefined);
      const envelope = await context.listener("counter")(createEvent(createContents()), 1);
      context.ipc.tokens.handle(() => ({ next: () => undefined }));
      const other = await context.listener("tokens")(createEvent(createContents()), 1, "x");

      for (const answer of [envelope, other]) {
         expect(answer).toStrictEqual({
            ok: false,
            error: expect.objectContaining({ code: "IPC_STREAM_NOT_ITERABLE" }),
         });
      }
      expect(channelsMade).toHaveLength(0);
   });

   it("answers an error that the handler throws before it returns, with its name, code and data", async () => {
      const context = await loadMain();
      context.ipc.counter.handle(() => {
         throw Object.assign(new Error("gone"), {
            name: "NotFoundError",
            code: "E_NOT_FOUND",
            data: { id: 1 },
         });
      });
      const envelope = await context.listener("counter")(createEvent(createContents()), 1);

      expect(envelope).toStrictEqual({
         ok: false,
         error: { name: "NotFoundError", message: "gone", code: "E_NOT_FOUND", data: { id: 1 } },
      });
      expect(channelsMade).toHaveLength(0);
   });

   it("closes the channel and stops the iterator when the port cannot be handed over", async () => {
      const context = await loadMain();
      const source = createSource();
      context.ipc.counter.handle(() => source.iterable);
      const frame = createFrame();
      frame.postMessage.mockImplementation(() => {
         throw new Error("The frame is gone");
      });

      const envelope = await context.listener("counter")(createEvent(createContents(), frame), 1);

      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({ message: "The frame is gone" }),
      });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(source.iterator.next).not.toHaveBeenCalled();
   });
});

describe("stream, main process, sending", () => {
   it("sends the chunks in order, then the end, and closes the port", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");

      source.push(1);
      source.push({ nested: [2] });
      source.push("three");
      source.end();
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: 1 },
         { type: "chunk", value: { nested: [2] } },
         { type: "chunk", value: "three" },
         { type: "end" },
      ]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).not.toHaveBeenCalled();
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("keeps the order of chunks which the generator produced before the first was sent", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      for (let value = 0; value < 200; value++) {
         source.push(value);
      }
      source.end();
      await settle();

      expect(posted().slice(0, -1)).toStrictEqual(
         Array.from({ length: 200 }, (_, value) => ({ type: "chunk", value })),
      );
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });

   it("sends an empty stream as the end alone", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.end();
      await settle();

      expect(posted()).toStrictEqual([{ type: "end" }]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("sends the error of the generator after the chunks before it, and closes the port", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.push(1);
      source.fail({ name: "Boom", message: "exploded", code: "E1", data: { n: 1 } });
      source.push(2);
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: 1 },
         {
            type: "error",
            error: { name: "Boom", message: "exploded", code: "E1", data: { n: 1 } },
         },
      ]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      // A generator which threw has finished, so there is nothing to stop.
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("reduces an Error of the generator to its name and message", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.fail(new TypeError("bad input"));
      await settle();

      expect(posted()).toStrictEqual([
         { type: "error", error: { name: "TypeError", message: "bad input" } },
      ]);
   });

   it("fails the stream when a chunk cannot be sent, and stops the generator", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      lastChannel().port1.postMessage.mockImplementationOnce(() => undefined);
      lastChannel().port1.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      source.push("fine");
      source.push(() => 1);
      source.push("never sent");
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: "fine" },
         { type: "chunk", value: expect.any(Function) },
         {
            type: "error",
            error: {
               name: "IpcStreamError",
               message:
                  "A chunk of the channel 'counter' cannot be sent: An object could not be cloned.",
               code: "IPC_STREAM_UNSENDABLE",
            },
         },
      ]);
      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("keeps running two calls of a channel apart", async () => {
      const context = await loadMain();
      const first = await start(context, "counter", { id: 1 });
      const firstChannel = lastChannel();
      const second = await start(context, "counter", { id: 2 });
      const secondChannel = lastChannel();

      first.source.push("a");
      second.source.push("b");
      second.source.end();
      await settle();
      firstChannel.port1.emit("message", { data: { type: "cancel" } });

      expect(firstChannel.port1.postMessage.mock.calls).toStrictEqual([
         [{ type: "chunk", value: "a" }],
      ]);
      expect(secondChannel.port1.postMessage.mock.calls).toStrictEqual([
         [{ type: "chunk", value: "b" }],
         [{ type: "end" }],
      ]);
      expect(first.source.iterator.return).toHaveBeenCalledOnce();
      expect(second.source.iterator.return).not.toHaveBeenCalled();
   });
});

describe("stream, main process, cancelling", () => {
   it("calls return() on the generator once on a cancel message, and sends nothing after it", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");
      source.push(1);
      await settle();

      fromPage({ type: "cancel" });
      fromPage({ type: "cancel" });
      source.push(2);
      source.end();
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("calls return() while the generator is waiting, and drops the chunk it produces then", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      await settle();
      expect(source.iterator.next).toHaveBeenCalledOnce();

      fromPage({ type: "cancel" });
      expect(source.iterator.return).toHaveBeenCalledOnce();
      source.push("late");
      await settle();

      expect(posted()).toStrictEqual([]);
      expect(source.iterator.next).toHaveBeenCalledOnce();
   });

   it("cancels when the page closes its port", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      source.push(1);
      await settle();

      lastChannel().port1.emit("close");
      source.push(2);
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
   });

   it("cancels when the contents are destroyed", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");

      contents.emit("destroyed");
      lastChannel().port1.emit("close");
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("ignores messages of the page which are not a cancel", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      for (const data of [null, undefined, "cancel", 3, { type: "chunk" }, { kind: "cancel" }]) {
         fromPage(data);
      }
      source.push(1);
      await settle();

      expect(source.iterator.return).not.toHaveBeenCalled();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
   });

   it("does not stop a generator which has ended when the port closes afterwards", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      source.end();
      await settle();

      lastChannel().port1.emit("close");
      fromPage({ type: "cancel" });

      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("runs the finally block of a real async generator when the page cancels", async () => {
      const context = await loadMain();
      const log: string[] = [];
      context.ipc.counter.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
               await new Promise((resolve) => setTimeout(resolve, 1));
               yield n;
            }
         } finally {
            log.push("finally");
         }
      });
      await context.listener("counter")(createEvent(createContents()), 1);
      await new Promise((resolve) => setTimeout(resolve, 30));

      fromPage({ type: "cancel" });
      await settle();
      const count = posted().length;
      await settle();

      expect(log).toStrictEqual(["finally"]);
      expect(count).toBeGreaterThan(0);
      expect(posted()).toHaveLength(count);
   });
});

describe("stream, main process, handler registration", () => {
   it("replaces the handler of the channel, and a replaced disposer does nothing", async () => {
      const { ipc, electron } = await loadMain();
      const stopFirst = ipc.counter.handle(async function* () {});
      const stopSecond = ipc.counter.handle(async function* () {});

      stopFirst();
      expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(2);
      electron.ipcMain.removeHandler.mockClear();
      stopSecond();

      expect(electron.ipcMain.removeHandler).toHaveBeenCalledExactlyOnceWith(wire("counter"));
   });

   it("has no handleOnce", async () => {
      const { ipc } = await loadMain();

      expect(Object.keys(ipc.counter)).toStrictEqual(["handle"]);
      expect(Object.keys(ipc.getUser)).toStrictEqual(["handle", "handleOnce"]);
   });
});

describe("stream, main process, sender and argument checks", () => {
   it("rejects a sender of another origin with the envelope, and runs nothing", async () => {
      const context = await loadMain();
      const onRejected = vi.fn();
      context.configureIpc({ onRejected });
      const { handler, envelope } = await start(context, "guarded", {
         args: [3],
         frame: createFrame({ origin: "https://evil.example" }),
      });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({ name: "IpcForbiddenError", code: "IPC_FORBIDDEN" }),
      });
      expect(onRejected).toHaveBeenCalledOnce();
   });

   it("rejects a call without a frame, and applies validateSender", async () => {
      const context = await loadMain();
      const noFrame = await start(context, "guarded", { args: [3], frame: null });
      expect(noFrame.envelope).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });

      context.configureIpc({ validateSender: () => false });
      const refused = await start(context, "guarded", { args: [3] });
      expect(refused.envelope).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
      expect(channelsMade).toHaveLength(0);
   });

   it("lets an allowed sender with valid arguments start the stream", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "guarded", { args: [3] });

      expect(envelope).toStrictEqual({ ok: true, value: undefined });
      expect(handler).toHaveBeenCalledWith(expect.anything(), 3);
      expect(channelsMade).toHaveLength(1);
   });

   it("answers invalid arguments with the validation error and its issues, before the handler", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "guarded", { args: ["three"] });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: {
            name: "IpcValidationError",
            message: "The arguments of the channel 'guarded' are invalid: expected one number",
            code: "IPC_VALIDATION",
            data: [{ message: "expected one number", path: undefined }],
         },
      });
   });

   it("never starts a stream for a sender which an unvalidated channel does not restrict", async () => {
      const context = await loadMain();
      const { envelope } = await start(context, "counter", { frame: null });

      expect(envelope).toStrictEqual({ ok: true, value: undefined });
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
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
}

async function loadPreload() {
   project = await runFixture("stream-channels");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const invoke = fake.electron.ipcRenderer.invoke;
   invoke.mockResolvedValue({ ok: true, value: undefined });
   /** Hands a port to the page, the way the main process does. */
   const arrive = (
      name: string,
      id: unknown,
      port: FakePagePort | undefined = new FakePagePort(),
   ) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === portWire(name),
      );
      if (!call) {
         throw new Error(`The preload script does not listen on '${portWire(name)}'`);
      }
      (call[1] as (event: unknown, id: unknown) => void)({ ports: port ? [port] : [] }, id);
      return port;
   };
   return { api: fake.exposed.ipc, invoke, arrive, fake };
}

/** What a read of the stream settles with, as a plain description. */
async function settleRead(promise: Promise<unknown>) {
   return promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );
}

describe("stream, preload script, the API of the page", () => {
   it("exposes stream for every stream channel, and nothing else for it", async () => {
      const { api } = await loadPreload();

      expect(Object.keys(api.exportRows)).toStrictEqual(["stream"]);
      expect(callablePaths(api)).toContain("tokens.stream");
      expect(callablePaths(api)).toContain("getUser.invoke");
      expect(callablePaths(api)).toContain("notice.on");
   });

   it("matches the members of window.d.ts", async () => {
      const { api } = await loadPreload();

      expect(callablePaths(api)).toStrictEqual(
         windowIpcPaths(project?.generated["window.d.ts"] ?? ""),
      );
   });

   it("returns a stream with next, return, cancel and an async iterator which is itself", async () => {
      const { api } = await loadPreload();
      const stream = api.counter.stream();

      expect(Object.keys(stream).sort()).toStrictEqual(["cancel", "next", "return"]);
      expect(stream[Symbol.asyncIterator]()).toBe(stream);
   });

   it("calls the main process with a new ID and the arguments of the call", async () => {
      const { api, invoke } = await loadPreload();

      api.exportRows.stream("people", 3);
      api.exportRows.stream("orders");
      api.progress.stream("job", true, false);

      expect(invoke.mock.calls).toStrictEqual([
         [wire("exportRows"), 1, "people", 3],
         [wire("exportRows"), 2, "orders"],
         [wire("progress"), 3, "job", true, false],
      ]);
   });
});

describe("stream, preload script, reading", () => {
   it("reads the chunks in order, then done", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "chunk", value: { a: 1 } });
      port.deliver({ type: "end" });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await stream.next()).toStrictEqual({ done: false, value: { a: 1 } });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("resolves a read which waits for the chunk, and several reads in the order they were made", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const reads = [stream.next(), stream.next(), stream.next(), stream.next()];

      port.deliver({ type: "chunk", value: "a" });
      port.deliver({ type: "chunk", value: "b" });
      port.deliver({ type: "end" });

      expect(await Promise.all(reads)).toStrictEqual([
         { done: false, value: "a" },
         { done: false, value: "b" },
         { done: true, value: undefined },
         { done: true, value: undefined },
      ]);
   });

   it("works with for await, and returns the chunks of several streams without mixing them", async () => {
      const { api, arrive } = await loadPreload();
      const one = api.counter.stream();
      const two = api.counter.stream();
      const portOne = arrive("counter", 1);
      const portTwo = arrive("counter", 2);
      portOne.deliver({ type: "chunk", value: "one" });
      portTwo.deliver({ type: "chunk", value: "two" });
      portOne.deliver({ type: "end" });
      portTwo.deliver({ type: "end" });

      const collect = async (stream: AsyncIterable<unknown>) => {
         const seen: unknown[] = [];
         for await (const chunk of stream) {
            seen.push(chunk);
         }
         return seen;
      };

      expect(await collect(one)).toStrictEqual(["one"]);
      expect(await collect(two)).toStrictEqual(["two"]);
   });

   it("rejects a read with the error object, after the chunks which came before it", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const error = { name: "Boom", message: "exploded", code: "E1", data: { n: 1 } };

      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "error", error });
      port.deliver({ type: "chunk", value: "ignored" });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settleRead(stream.next())).toStrictEqual({ error });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("rejects a waiting read when the error arrives, and a for await loop throws it", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const error = { name: "Boom", message: "exploded" };

      const loop = (async () => {
         for await (const _chunk of stream) {
            // Reads until the error.
         }
      })();
      port.deliver({ type: "error", error });

      await expect(loop).rejects.toStrictEqual(error);
   });

   it("ignores messages which are not chunks, ends or errors, and ones after the end", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      port.deliver(null);
      port.deliver("chunk");
      port.deliver({ type: "unknown", value: 1 });
      port.deliver({ type: "chunk", value: "kept" });
      port.deliver({ type: "end" });
      port.deliver({ type: "chunk", value: "late" });

      expect(await stream.next()).toStrictEqual({ done: false, value: "kept" });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });
});

describe("stream, preload script, a call that fails to start", () => {
   it("rejects the first read with the error of the envelope", async () => {
      const { api, invoke } = await loadPreload();
      const error = { name: "IpcForbiddenError", message: "not allowed", code: "IPC_FORBIDDEN" };
      invoke.mockResolvedValueOnce({ ok: false, error });
      const stream = api.guarded.stream(1);

      expect(await settleRead(stream.next())).toStrictEqual({ error });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("keeps going when the envelope says the call was accepted", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      await settle();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
   });

   it("rejects the read with the error of Electron when no handler is registered", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockRejectedValueOnce(
         new Error("Error invoking remote method 'autoipc:progress': No handler registered"),
      );
      const stream = api.progress.stream("job");

      expect(await settleRead(stream.next())).toStrictEqual({
         error: {
            name: "Error",
            message: "Error invoking remote method 'autoipc:progress': No handler registered",
         },
      });
   });

   it("rejects the read when the arguments cannot be sent", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockImplementationOnce(() => {
         throw Object.assign(new Error("An object could not be cloned."), {
            name: "DataCloneError",
         });
      });
      const stream = api.exportRows.stream("people");

      expect(await settleRead(stream.next())).toStrictEqual({
         error: { name: "DataCloneError", message: "An object could not be cloned." },
      });
   });

   it("rejects the read when the reply is not an envelope", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockResolvedValueOnce(undefined);
      const stream = api.counter.stream();

      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({
            name: "IpcStreamError",
            code: "IPC_STREAM_INVALID_REPLY",
         }),
      });
   });

   it("closes a port which arrives for a stream that has failed", async () => {
      const { api, invoke, arrive } = await loadPreload();
      invoke.mockResolvedValueOnce({ ok: false, error: { name: "Error", message: "no" } });
      api.counter.stream();
      await settle();

      const port = arrive("counter", 1);

      expect(port.close).toHaveBeenCalledOnce();
   });
});

describe("stream, preload script, cancelling", () => {
   it("tells the main process, closes the port, drops the chunks and ends the reads", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });
      const waiting = stream.next();
      port.deliver({ type: "chunk", value: 2 });
      await waiting;

      stream.cancel();
      stream.cancel();

      expect(port.postMessage.mock.calls).toStrictEqual([[{ type: "cancel" }]]);
      expect(port.close).toHaveBeenCalledOnce();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("ends a read which is waiting", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      arrive("counter", 1);
      const waiting = stream.next();

      stream.cancel();

      expect(await waiting).toStrictEqual({ done: true, value: undefined });
   });

   it("does the same for return(), which resolves done", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      expect(await stream.return()).toStrictEqual({ done: true, value: undefined });

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("calls return() when a for await loop breaks", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "chunk", value: 2 });

      for await (const chunk of stream) {
         expect(chunk).toBe(1);
         break;
      }

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("stops with an abort signal of the page", async () => {
      const { api, arrive } = await loadPreload();
      const controller = new AbortController();
      const stream = api.counter.stream();
      controller.signal.addEventListener("abort", () => stream.cancel(), { once: true });
      const port = arrive("counter", 1);

      controller.abort();

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
   });

   it("closes a port that arrives after the cancel, and sends no message on it", async () => {
      const { api, invoke, arrive } = await loadPreload();
      const stream = api.counter.stream();

      stream.cancel();
      const port = arrive("counter", 1);

      expect(invoke).toHaveBeenCalledOnce();
      expect(port.close).toHaveBeenCalledOnce();
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("does nothing when the stream has ended", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "end" });

      stream.cancel();

      expect(port.postMessage).not.toHaveBeenCalled();
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("survives a port which cannot be posted to", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.postMessage.mockImplementation(() => {
         throw new Error("The port is closed");
      });

      expect(() => stream.cancel()).not.toThrow();
      expect(port.close).toHaveBeenCalledOnce();
   });
});

describe("stream, preload script, a port that goes away", () => {
   it("fails the stream with IPC_STREAM_CLOSED when the port closes before the end", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });

      port.emitClose();

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settleRead(stream.next())).toStrictEqual({
         error: {
            name: "IpcStreamError",
            message: "The stream of the channel 'counter' was closed before it ended",
            code: "IPC_STREAM_CLOSED",
         },
      });
   });

   it("ignores the close of the port after the end, the error and the cancel", async () => {
      const { api, arrive } = await loadPreload();
      const ended = api.counter.stream();
      const failed = api.counter.stream();
      const cancelled = api.counter.stream();
      const portEnded = arrive("counter", 1);
      const portFailed = arrive("counter", 2);
      const portCancelled = arrive("counter", 3);
      portEnded.deliver({ type: "end" });
      portFailed.deliver({ type: "error", error: { name: "Boom", message: "x" } });
      cancelled.cancel();

      for (const port of [portEnded, portFailed, portCancelled]) {
         port.emitClose();
      }

      expect(await ended.next()).toStrictEqual({ done: true, value: undefined });
      expect(await settleRead(failed.next())).toStrictEqual({
         error: { name: "Boom", message: "x" },
      });
      expect(await cancelled.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("closes a port for an ID which no stream waits for, or no port at all", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();

      const stray = arrive("counter", 99);
      const wrongType = arrive("counter", "1");
      arrive("counter", 1, undefined);

      expect(stray.close).toHaveBeenCalledOnce();
      expect(wrongType.close).toHaveBeenCalledOnce();
      stream.cancel();
   });
});

describe("window.d.ts of stream channels", () => {
   it("declares IpcStream and the stream method of every channel", async () => {
      project = await runFixture("stream-channels");
      const types = project.generated["window.d.ts"];

      expect(types).toContain("interface IpcStream<T> {");
      expect(types).toContain("stream: (table: string, limit?: number) => IpcStream<Row>;");
      expect(types).toContain("stream: (prompt: string) => IpcStream<string>;");
      expect(types).toContain("stream: () => IpcStream<number>;");
      expect(types).toContain("stream: (job: string, ...flags: boolean[]) => IpcStream<Progress>;");
      expect(types).toContain("stream: <T>(seed: T) => IpcStream<T>;");
      expect(types).toContain("stream: (count: number) => IpcStream<number>;");
      expect(types).toContain("@throws {IpcError<NotFoundError>}");
      expect(types).toContain('import type { NotFoundError } from "./schema";');
   });

   it("type-checks the generated files and a program which uses them", async () => {
      project = await runFixture("stream-channels");

      expect(await project.typecheck()).toBe("");
   });

   it("declares nothing of streams for a schema without them", async () => {
      project = await runFixture("ask-channels");

      expect(project.generated["window.d.ts"]).not.toContain("IpcStream");
      expect(project.generated["preload.ts"]).not.toContain("openStream");
      expect(project.generated["main.ts"]).not.toContain("startStream");
      expect(project.generated["main.ts"]).not.toContain("MessageChannelMain");
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

/** Both generated scripts, wired to each other the way Electron does for one page. */
async function loadBoth() {
   const main = await loadMainWith(RealChannelMain);
   const fake = createFakePreloadElectron();
   if (!project) {
      throw new Error("The fixture was not generated");
   }
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const contents = createContents();
   const frame = createFrame();
   frame.postMessage.mockImplementation((channel: string, id: unknown, ports: unknown[]) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      if (!call) {
         throw new Error(`The page does not listen on '${channel}'`);
      }
      (call[1] as (event: unknown, id: unknown) => void)({ ports }, id);
   });
   fake.electron.ipcRenderer.invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      const name = channel.replace("autoipc:", "");
      return main.listener(name)(createEvent(contents, frame), ...args);
   });
   return { ...main, api: fake.exposed.ipc, contents, frame };
}

describe("a main process and a page over real message channels", () => {
   it("streams the rows of an async generator to a for await loop", async () => {
      const { ipc, api } = await loadBoth();
      ipc.exportRows.handle(async function* (_event: unknown, table: string, limit = 3) {
         for (let id = 1; id <= limit; id++) {
            yield { id, label: `${table}-${id}` };
         }
      });

      const rows: unknown[] = [];
      for await (const row of api.exportRows.stream("people", 4)) {
         rows.push(row);
      }

      expect(rows).toStrictEqual([
         { id: 1, label: "people-1" },
         { id: 2, label: "people-2" },
         { id: 3, label: "people-3" },
         { id: 4, label: "people-4" },
      ]);
   });

   it("keeps the order of a thousand chunks which are produced without waiting", async () => {
      const { ipc, api } = await loadBoth();
      ipc.asForm.handle(async function* (_event: unknown, count: number) {
         for (let n = 0; n < count; n++) {
            yield n;
         }
      });

      const seen: number[] = [];
      for await (const n of api.asForm.stream(1000)) {
         seen.push(n);
      }

      expect(seen).toStrictEqual(Array.from({ length: 1000 }, (_, n) => n));
   });

   it("ends a stream without chunks", async () => {
      const { ipc, api } = await loadBoth();
      ipc.counter.handle(async function* () {});

      const stream = api.counter.stream();

      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("stops the generator when the page breaks out of the loop, and runs its finally block", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.counter.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
               await new Promise((resolve) => setTimeout(resolve, 1));
               yield n;
            }
         } finally {
            log.push("finally");
         }
      });

      const seen: number[] = [];
      for await (const n of api.counter.stream()) {
         seen.push(n);
         if (n === 2) {
            break;
         }
      }
      await settle();

      expect(seen).toStrictEqual([0, 1, 2]);
      expect(log).toStrictEqual(["finally"]);
   });

   it("stops the generator when the page cancels from an abort signal", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.tokens.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
               await new Promise((resolve) => setTimeout(resolve, 1));
               yield `token ${n}`;
            }
         } finally {
            log.push("finally");
         }
      });
      const controller = new AbortController();
      const stream = api.tokens.stream("go");
      controller.signal.addEventListener("abort", () => stream.cancel(), { once: true });

      const first = await stream.next();
      controller.abort();
      await settle();

      expect(first).toStrictEqual({ done: false, value: "token 0" });
      expect(log).toStrictEqual(["finally"]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails the loop of the page with the error of the generator, after its chunks", async () => {
      const { ipc, api } = await loadBoth();
      ipc.tokens.handle(async function* () {
         yield "a";
         yield "b";
         throw Object.assign(new Error("exploded"), { name: "Boom", code: "E1", data: { n: 1 } });
      });

      const seen: string[] = [];
      let failure: unknown;
      try {
         for await (const token of api.tokens.stream("go")) {
            seen.push(token);
         }
      } catch (error) {
         failure = error;
      }

      expect(seen).toStrictEqual(["a", "b"]);
      expect(failure).toStrictEqual({
         name: "Boom",
         message: "exploded",
         code: "E1",
         data: { n: 1 },
      });
   });

   it("fails the stream with the unsendable code for a chunk that cannot be cloned", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.tokens.handle(async function* () {
         try {
            yield "fine";
            yield () => 1;
            yield "never";
         } finally {
            log.push("finally");
         }
      });

      const stream = api.tokens.stream("go");

      expect(await stream.next()).toStrictEqual({ done: false, value: "fine" });
      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({ name: "IpcStreamError", code: "IPC_STREAM_UNSENDABLE" }),
      });
      await settle();
      expect(log).toStrictEqual(["finally"]);
   });

   it("fails the first read when the sender is rejected, with no stream made", async () => {
      const { ipc, api, frame } = await loadBoth();
      const handler = vi.fn(async function* () {});
      ipc.guarded.handle(handler);
      Object.assign(frame, { origin: "https://evil.example" });

      const stream = api.guarded.stream(3);

      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({ code: "IPC_FORBIDDEN" }),
      });
      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
   });

   it("fails the first read when the arguments are invalid", async () => {
      const { ipc, api } = await loadBoth();
      ipc.guarded.handle(async function* (_event: unknown, count: number) {
         yield count;
      });

      const bad = api.guarded.stream("three");
      const good = api.guarded.stream(3);

      expect(await settleRead(bad.next())).toStrictEqual({
         error: expect.objectContaining({ code: "IPC_VALIDATION" }),
      });
      expect(await good.next()).toStrictEqual({ done: false, value: 3 });
   });

   it("runs several streams of one channel at the same time", async () => {
      const { ipc, api } = await loadBoth();
      ipc.asForm.handle(async function* (_event: unknown, count: number) {
         for (let n = 0; n < count; n++) {
            // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
            await new Promise((resolve) => setTimeout(resolve, 1));
            yield `${count}:${n}`;
         }
      });
      const read = async (count: number) => {
         const seen: string[] = [];
         for await (const chunk of api.asForm.stream(count)) {
            seen.push(chunk);
         }
         return seen;
      };

      const [two, three] = await Promise.all([read(2), read(3)]);

      expect(two).toStrictEqual(["2:0", "2:1"]);
      expect(three).toStrictEqual(["3:0", "3:1", "3:2"]);
   });
});

describe("stream, main process, flow control", () => {
   const credit = (limit: unknown) => ({ type: "credit", limit });
   /** The values of the chunks that were sent, in order. */
   const sentValues = () =>
      posted()
         .filter((message) => message.type === "chunk")
         .map((message) => message.value);
   const upTo = (count: number) => Array.from({ length: count }, (_, value) => value);
   const fill = (source: ReturnType<typeof createSource>, count: number) => {
      for (const value of upTo(count)) {
         source.push(value);
      }
   };

   it("stops pulling from the generator once highWaterMark chunks are sent, and goes on when the page grants more", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");

      fill(source, 10);
      await settle();
      expect(sentValues()).toStrictEqual(upTo(4));
      expect(source.iterator.next).toHaveBeenCalledTimes(4);

      fromPage(credit(6));
      await settle();
      expect(sentValues()).toStrictEqual(upTo(6));
      expect(source.iterator.next).toHaveBeenCalledTimes(6);

      fromPage(credit(100));
      source.end();
      await settle();
      expect(sentValues()).toStrictEqual(upTo(10));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("uses a window of 1024 chunks when the channel sets none", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      fill(source, 1500);
      await settle();
      expect(sentValues()).toHaveLength(1024);
      expect(source.iterator.next).toHaveBeenCalledTimes(1024);

      fromPage(credit(1600));
      await settle();
      expect(sentValues()).toStrictEqual(upTo(1500));
   });

   it("never pauses a channel with an infinite window", async () => {
      const context = await loadMain();
      const { source } = await start(context, "unbounded");

      fill(source, 3000);
      source.end();
      await settle();

      expect(sentValues()).toStrictEqual(upTo(3000));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });

   it("pulls only what the page grants when the window is 0", async () => {
      const context = await loadMain();
      const { source } = await start(context, "pulled");

      fill(source, 3);
      await settle();
      expect(source.iterator.next).not.toHaveBeenCalled();
      expect(posted()).toStrictEqual([]);

      fromPage(credit(1));
      await settle();
      expect(sentValues()).toStrictEqual([0]);

      fromPage(credit(3));
      await settle();
      expect(sentValues()).toStrictEqual([0, 1, 2]);
      expect(source.iterator.next).toHaveBeenCalledTimes(3);
   });

   it("ignores a credit which does not raise the limit, or is not a number", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 10);
      await settle();

      // The credits come in the same turn as one that raises the limit to 8, before the paused
      // generator goes on, so a lower one that was taken would shrink the window it has.
      fromPage(credit(8));
      for (const limit of [7, 4, 0, -5, "9", Number.NaN, null, undefined, {}, [9], true]) {
         fromPage(credit(limit));
      }
      fromPage({ type: "credit" });
      fromPage({ type: "creditt", limit: 9 });
      fromPage(null);
      await settle();

      expect(sentValues()).toStrictEqual(upTo(8));
      expect(source.iterator.next).toHaveBeenCalledTimes(8);
   });

   it("keeps the credits of two calls apart", async () => {
      const context = await loadMain();
      const first = await start(context, "windowed", { id: 1 });
      const second = await start(context, "windowed", { id: 2 });
      fill(first.source, 10);
      fill(second.source, 10);
      await settle();

      channelsMade[1].port1.emit("message", { data: credit(7) });
      await settle();

      expect(channelsMade[0].port1.postMessage).toHaveBeenCalledTimes(4);
      expect(channelsMade[1].port1.postMessage).toHaveBeenCalledTimes(7);
   });

   it("cancels a paused stream: the generator runs its finally block at once, and nothing is sent", async () => {
      const context = await loadMain();
      let produced = 0;
      let finalized = 0;
      context.ipc.windowed.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               produced += 1;
               yield n;
            }
         } finally {
            finalized += 1;
         }
      });
      await context.listener("windowed")(createEvent(createContents(), createFrame()), 7);
      await settle();
      expect(produced).toBe(4);
      expect(finalized).toBe(0);

      fromPage({ type: "cancel" });
      await settle();
      fromPage(credit(50));
      await settle();

      expect(finalized).toBe(1);
      expect(produced).toBe(4);
      expect(sentValues()).toStrictEqual(upTo(4));
      expect(posted().some((message) => message.type === "end" || message.type === "error")).toBe(
         false,
      );
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("stops a paused stream when the page closes the port, and when the contents are destroyed", async () => {
      const context = await loadMain();
      const closed = await start(context, "windowed", { id: 1 });
      const contents = createContents();
      const destroyed = await start(context, "windowed", { id: 2, contents });
      fill(closed.source, 10);
      fill(destroyed.source, 10);
      await settle();

      channelsMade[0].port1.emit("close");
      contents.emit("destroyed");
      await settle();
      channelsMade[0].port1.emit("message", { data: credit(50) });
      channelsMade[1].port1.emit("message", { data: credit(50) });
      await settle();

      expect(closed.source.iterator.return).toHaveBeenCalledOnce();
      expect(destroyed.source.iterator.return).toHaveBeenCalledOnce();
      expect(closed.source.iterator.next).toHaveBeenCalledTimes(4);
      expect(destroyed.source.iterator.next).toHaveBeenCalledTimes(4);
      expect(channelsMade[0].port1.postMessage).toHaveBeenCalledTimes(4);
      expect(channelsMade[1].port1.postMessage).toHaveBeenCalledTimes(4);
   });

   it("sends the error of the generator after the chunks, once the page has granted the pull that finds it", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 4);
      source.fail({ name: "Boom", message: "exploded", code: "E1" });
      await settle();
      expect(posted()).toHaveLength(4);

      fromPage(credit(5));
      await settle();

      expect(posted().slice(0, 4)).toStrictEqual(
         upTo(4).map((value) => ({ type: "chunk", value })),
      );
      expect(posted()[4]).toStrictEqual({
         type: "error",
         error: { name: "Boom", message: "exploded", code: "E1" },
      });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("keeps the order of the chunks across many pauses", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 100);
      source.end();

      for (let limit = 4; limit <= 104; limit += 2) {
         // biome-ignore lint/performance/noAwaitInLoops: each grant lets the pump run to the next pause
         await settle();
         fromPage(credit(limit));
      }
      await settle();

      expect(sentValues()).toStrictEqual(upTo(100));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });
});

describe("stream, preload script, flow control", () => {
   const sentCredits = (port: FakePagePort) =>
      port.postMessage.mock.calls
         .map(([message]) => message as { type: string; limit?: number })
         .filter((message) => message.type === "credit")
         .map((message) => message.limit);
   const chunks = (port: FakePagePort, count: number, from = 0) => {
      for (let n = from; n < from + count; n++) {
         port.deliver({ type: "chunk", value: n });
      }
   };

   it("grants more once half of the window is read, as a total, so that the queue does not run dry", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.windowed.stream();
      const port = arrive("windowed", 1);
      chunks(port, 4);

      await stream.next();
      expect(sentCredits(port)).toStrictEqual([]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6, 8]);
   });

   it("grants nothing while the page does not read", async () => {
      const { api, arrive } = await loadPreload();
      api.windowed.stream();
      const port = arrive("windowed", 1);

      chunks(port, 4);
      await settle();

      expect(sentCredits(port)).toStrictEqual([]);
   });

   it("grants the reads which wait first, when the window is 0, and the port has arrived later", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.pulled.stream();
      const first = stream.next();
      const second = stream.next();
      const port = arrive("pulled", 1);
      expect(sentCredits(port)).toStrictEqual([2]);

      chunks(port, 2);
      expect(await Promise.all([first, second])).toStrictEqual([
         { done: false, value: 0 },
         { done: false, value: 1 },
      ]);
      expect(sentCredits(port)).toStrictEqual([2]);

      const third = stream.next();
      expect(sentCredits(port)).toStrictEqual([2, 3]);
      port.deliver({ type: "end" });
      expect(await third).toStrictEqual({ done: true, value: undefined });
   });

   it("never grants when the window is infinite, or before the default window is half read", async () => {
      const { api, arrive } = await loadPreload();
      const unbounded = api.unbounded.stream();
      const unboundedPort = arrive("unbounded", 1);
      const standard = api.counter.stream();
      const standardPort = arrive("counter", 2);
      chunks(unboundedPort, 2000);
      chunks(standardPort, 2000);

      for (let read = 0; read < 511; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
         await standard.next();
      }
      expect(sentCredits(standardPort)).toStrictEqual([]);
      await standard.next();
      expect(sentCredits(standardPort)).toStrictEqual([1536]);

      for (let read = 0; read < 1400; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
      }
      expect(sentCredits(unboundedPort)).toStrictEqual([]);
   });

   it("grants nothing after the stream ended, failed or was cancelled", async () => {
      const { api, arrive } = await loadPreload();
      const ended = api.windowed.stream();
      const endedPort = arrive("windowed", 1);
      const cancelled = api.windowed.stream();
      const cancelledPort = arrive("windowed", 2);
      chunks(endedPort, 2);
      chunks(cancelledPort, 4);
      endedPort.deliver({ type: "end" });

      cancelled.cancel();
      await cancelled.next();
      await ended.next();
      await ended.next();

      expect(sentCredits(endedPort)).toStrictEqual([]);
      expect(sentCredits(cancelledPort)).toStrictEqual([]);
   });

   it("keeps reading when a grant cannot be posted, and grants the new total at the next read", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.windowed.stream();
      const port = arrive("windowed", 1);
      chunks(port, 8);
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("The port is closed");
      });

      const values: number[] = [];
      for (let read = 0; read < 4; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         values.push((await stream.next()).value);
      }

      expect(values).toStrictEqual([0, 1, 2, 3]);
      // The first attempt (6) threw, so the next read grants the total of that moment.
      expect(sentCredits(port)).toStrictEqual([6, 7]);
   });
});

describe("stream, main process and page, flow control over real message channels", () => {
   /** A generator which counts the chunks that it produced. */
   const counting = (state: { produced: number; finalized: boolean }) =>
      async function* () {
         try {
            for (;;) {
               state.produced += 1;
               yield state.produced;
            }
         } finally {
            state.finalized = true;
         }
      };

   it("keeps a fast generator within the window of a reader which stopped reading", async () => {
      const { ipc, api } = await loadBoth();
      const state = { produced: 0, finalized: false };
      ipc.windowed.handle(counting(state));

      const stream = api.windowed.stream();
      for (let read = 0; read < 3; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await stream.next();
      }
      await settle();
      await settle();

      // Three chunks are read, and the reader granted a window of 4 on top of those it read.
      expect(state.produced).toBeGreaterThanOrEqual(4);
      expect(state.produced).toBeLessThanOrEqual(3 + 4);
      const paused = state.produced;
      await settle();
      expect(state.produced).toBe(paused);

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("reads every chunk in order through many pauses, with a slow reader", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         for (let n = 0; n < 300; n++) {
            yield n;
         }
      });

      const seen: number[] = [];
      for await (const n of api.windowed.stream()) {
         seen.push(n);
         if (n % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 2));
         }
      }

      expect(seen).toStrictEqual(Array.from({ length: 300 }, (_, n) => n));
   });

   it("produces a chunk at a time for a reader that pulls, when the window is 0", async () => {
      const { ipc, api } = await loadBoth();
      const state = { produced: 0, finalized: false };
      ipc.pulled.handle(counting(state));

      const stream = api.pulled.stream();
      for (let read = 1; read <= 5; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         expect(await stream.next()).toStrictEqual({ done: false, value: read });
         await settle();
         expect(state.produced).toBe(read);
      }

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("ends a stream whose chunks exactly fill the window, and one that is shorter", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         yield* [1, 2, 3, 4];
      });
      ipc.pulled.handle(async function* () {
         yield* [1, 2];
      });

      const full: number[] = [];
      for await (const n of api.windowed.stream()) {
         full.push(n);
      }
      const pulled: number[] = [];
      for await (const n of api.pulled.stream()) {
         pulled.push(n);
      }

      expect(full).toStrictEqual([1, 2, 3, 4]);
      expect(pulled).toStrictEqual([1, 2]);
   });

   it("fails a paused stream with the error of the generator once the page reads on", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         yield* [1, 2, 3, 4];
         throw Object.assign(new Error("exploded"), { code: "E_BOOM" });
      });

      const seen: number[] = [];
      let failure: unknown;
      try {
         for await (const n of api.windowed.stream()) {
            seen.push(n);
         }
      } catch (error) {
         failure = error;
      }

      expect(seen).toStrictEqual([1, 2, 3, 4]);
      expect(failure).toMatchObject({ message: "exploded", code: "E_BOOM" });
   });
});
