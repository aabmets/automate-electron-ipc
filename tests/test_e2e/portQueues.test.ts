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
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const closeWire = (name: string) => `autoipc:${name}:close`;

let project: E2EProject;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
   project = await runFixture("bounded-ports");
});

afterAll(async () => {
   await project.cleanup();
});

beforeEach(() => {
   warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
   error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
   vi.restoreAllMocks();
});

/** The messages of the calls, such as `[["a"], ["b"]]` for `send("a")` and `send("b")`. */
const messages = (mock: { mock: { calls: unknown[][] } }) =>
   mock.mock.calls.map(([message]) => message);

/** Sends `count` messages `<prefix>1`, `<prefix>2`, ... with `send`. */
function sendMany(send: (...args: unknown[]) => void, count: number, prefix = "m") {
   for (let index = 1; index <= count; index++) {
      send(`${prefix}${index}`);
   }
}

/** The list `[[prefix + from], ..., [prefix + to]]` that `sendMany` would have queued. */
function range(from: number, to: number, prefix = "m") {
   return Array.from({ length: to - from + 1 }, (_, index) => [`${prefix}${from + index}`]);
}

// ---------------------------------------------------------------------------------------------
// The preload script
// ---------------------------------------------------------------------------------------------

/** A `MessagePort` of the page, as the preload script uses it. */
class FakePagePort {
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   onmessage: unknown = null;
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   /** The other end closes the port. */
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
}

/** Loads the generated preload script, and returns what it exposes and how to feed it ports. */
function loadPage() {
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   /** Hands the page a port of the connection with the key, which is the main process's job. */
   const pair = (channel: string, key = "1:main") => {
      const port = new FakePagePort();
      listener(wire(channel))({ ports: [port] }, key);
      return port;
   };
   const end = (channel: string, key = "1:main") => listener(closeWire(channel))({}, key);
   return { ipc: fake.exposed.ipc, pair, end };
}

/** The messages that a port was asked to post, in order. */
const posted = (port: FakePagePort) => messages(port.postMessage);

describe("the send queue of a port channel in the preload script", () => {
   describe("the queue of the channel, while there is no connection", () => {
      it("keeps the newest maxQueue messages, and flushes them in order to the first connection", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.chat.send, 5);
         const port = pair("chat");

         expect(posted(port)).toStrictEqual(range(4, 5));
      });

      it("drops the oldest message by default, and warns", () => {
         const { ipc } = loadPage();

         sendMany(ipc.chat.send, 3);

         expect(warn).toHaveBeenCalledOnce();
      });

      it("queues nothing for a maxQueue of 0", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.nobody.send, 4);
         const port = pair("nobody");

         expect(posted(port)).toStrictEqual([]);
      });

      it("never drops for a maxQueue of Infinity, and never warns", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.frames.send, 3000);
         const port = pair("frames");

         expect(posted(port)).toStrictEqual(range(1, 3000));
         expect(warn).not.toHaveBeenCalled();
      });

      it("holds 1000 messages when the channel sets no maxQueue", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.plain.send, 1001);
         const port = pair("plain");

         expect(posted(port)).toStrictEqual(range(2, 1001));
         expect(warn).toHaveBeenCalledOnce();
      });

      it("takes new messages again once the first connection has drained it", () => {
         const { ipc, pair, end } = loadPage();
         sendMany(ipc.chat.send, 3);
         pair("chat");
         end("chat");

         sendMany(ipc.chat.send, 2, "again");
         const port = pair("chat", "2:main");

         expect(posted(port)).toStrictEqual(range(1, 2, "again"));
      });
   });

   describe("the queue of a connection, while its port is closed", () => {
      /** A connection of `logTail`, which holds three messages, and the port it has lost. */
      function loadLostConnection() {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         const port = loaded.pair("logTail");
         port.emitClose();
         return { ...loaded, connection: connections[0], port };
      }

      it("keeps the newest maxQueue messages, and flushes them in order to the next port", () => {
         const { connection, pair } = loadLostConnection();

         sendMany(connection.send, 5);
         const next = pair("logTail");

         expect(posted(next)).toStrictEqual(range(3, 5));
      });

      it("takes new messages again after a flush", () => {
         const { connection, pair } = loadLostConnection();
         sendMany(connection.send, 4);
         const first = pair("logTail");
         first.emitClose();

         sendMany(connection.send, 3, "later");
         const second = pair("logTail");

         expect(posted(first)).toStrictEqual(range(2, 4));
         expect(posted(second)).toStrictEqual(range(1, 3, "later"));
      });

      it("holds nothing for a maxQueue of 0", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.nobody.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("nobody").emitClose();

         sendMany(connections[0].send, 3);
         const next = loaded.pair("nobody");

         expect(posted(next)).toStrictEqual([]);
      });

      it("keeps a queue per connection", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail", "1:main").emitClose();
         loaded.pair("logTail", "2:main").emitClose();

         sendMany(connections[0].send, 4, "one");
         sendMany(connections[1].send, 2, "two");

         expect(posted(loaded.pair("logTail", "1:main"))).toStrictEqual(range(2, 4, "one"));
         expect(posted(loaded.pair("logTail", "2:main"))).toStrictEqual(range(1, 2, "two"));
      });

      it("drops what is queued when the connection ends", () => {
         const { connection, end, pair } = loadLostConnection();
         sendMany(connection.send, 2);

         end("logTail");
         sendMany(connection.send, 2, "after");
         const port = pair("logTail");

         expect(posted(port)).toStrictEqual([]);
      });
   });

   describe("the overflow callback", () => {
      it("gets the new message and the info, and not the queue", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 3);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0]).toStrictEqual([
            ["m3"],
            { channel: "chat", max: 2, dropped: 0, warnings: 0 },
         ]);
      });

      it("hands over the whole argument list of the message", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.logTail.onOverflow(callback);

         for (const line of ["a", "b", "c"]) {
            ipc.logTail.send(line, 1);
         }
         ipc.logTail.send("d", 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0][0]).toStrictEqual(["d", 2]);
      });

      it("drops the oldest message for 'dropOldest'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "dropOldest");

         sendMany(ipc.chat.send, 3);

         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it("drops the new message for 'dropNewest'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "dropNewest");

         sendMany(ipc.chat.send, 4);

         expect(posted(pair("chat"))).toStrictEqual(range(1, 2));
      });

      it("drops everything that is queued and queues the new message for 'clear'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "clear");

         sendMany(ipc.chat.send, 3);
         ipc.chat.send("m4");

         expect(posted(pair("chat"))).toStrictEqual(range(3, 4));
      });

      it("counts what 'clear' dropped", () => {
         const { ipc } = loadPage();
         const callback = vi.fn((..._args: any[]) => "clear");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 3);
         ipc.chat.send("m4");
         ipc.chat.send("m5");

         // The first overflow cleared the two that were queued. m4 fitted, and m5 overflowed.
         expect(callback.mock.calls.map(([, info]) => info.dropped)).toStrictEqual([0, 2]);
      });

      it("falls back to dropping the oldest, and logs, when the callback throws", () => {
         const { ipc, pair } = loadPage();
         const failure = new Error("boom");
         ipc.chat.onOverflow(() => {
            throw failure;
         });

         sendMany(ipc.chat.send, 3);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it.each([
         ["undefined", undefined],
         ["a string that is not an action", "dropEverything"],
         ["an object", { action: "clear" }],
         ["a promise", Promise.resolve("clear")],
      ])("logs and drops the oldest when the callback returns %s", (_, value) => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => value);

         sendMany(ipc.chat.send, 3);

         expect(error).toHaveBeenCalledOnce();
         expect(String(error.mock.calls[0][0])).toMatch(
            /'chat'.*'dropOldest', 'dropNewest' or 'clear'/,
         );
         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it("is called for every message when maxQueue is 0, and nothing is queued whatever it answers", () => {
         const { ipc, pair } = loadPage();
         const callback = vi.fn(() => "clear");
         ipc.nobody.onOverflow(callback);

         sendMany(ipc.nobody.send, 3);

         expect(callback.mock.calls.map(([, info]) => info.dropped)).toStrictEqual([0, 1, 2]);
         expect(posted(pair("nobody"))).toStrictEqual([]);
      });

      it("counts a message that cannot be queued once, whichever action", () => {
         for (const action of ["dropOldest", "dropNewest", "clear"]) {
            const { ipc } = loadPage();
            const callback = vi.fn(() => action);
            ipc.nobody.onOverflow(callback);

            sendMany(ipc.nobody.send, 2);

            expect(callback.mock.calls[1][1].dropped).toBe(1);
         }
      });

      it("is not called while the queue has room", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 2);

         expect(callback).not.toHaveBeenCalled();
         expect(warn).not.toHaveBeenCalled();
      });
   });

   describe("the registration of the overflow callback", () => {
      /** A lost connection of `logTail`, with the callbacks that a test registers. */
      function loadConnection() {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail").emitClose();
         return { ...loaded, connection: connections[0] };
      }

      it("uses the callback of the connection over the one of the channel", () => {
         const { ipc, connection } = loadConnection();
         const ofChannel = vi.fn(() => "dropOldest");
         const ofConnection = vi.fn(() => "dropNewest");
         ipc.logTail.onOverflow(ofChannel);
         connection.onOverflow(ofConnection);

         sendMany(connection.send, 4);

         expect(ofChannel).not.toHaveBeenCalled();
         expect(ofConnection).toHaveBeenCalledOnce();
      });

      it("goes back to the callback of the channel when the override is disposed", () => {
         const { ipc, connection } = loadConnection();
         const ofChannel = vi.fn(() => "dropOldest");
         const ofConnection = vi.fn(() => "dropNewest");
         ipc.logTail.onOverflow(ofChannel);
         const dispose = connection.onOverflow(ofConnection);

         dispose();
         sendMany(connection.send, 4);

         expect(ofChannel).toHaveBeenCalledOnce();
         expect(ofConnection).not.toHaveBeenCalled();
      });

      it("goes back to the default when the callback of the channel is disposed", () => {
         const { ipc, connection, pair } = loadConnection();
         const ofChannel = vi.fn(() => "dropNewest");
         const dispose = ipc.logTail.onOverflow(ofChannel);

         dispose();
         sendMany(connection.send, 4);

         expect(ofChannel).not.toHaveBeenCalled();
         expect(posted(pair("logTail"))).toStrictEqual(range(2, 4));
      });

      it("replaces the previous callback, whose disposer then removes nothing", () => {
         const { ipc } = loadPage();
         const first = vi.fn(() => "dropOldest");
         const second = vi.fn(() => "dropOldest");
         const disposeFirst = ipc.chat.onOverflow(first);
         ipc.chat.onOverflow(second);

         disposeFirst();
         sendMany(ipc.chat.send, 3);

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledOnce();
      });

      it("keeps the callback of a connection apart from the ones of the other connections", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail", "1:main").emitClose();
         loaded.pair("logTail", "2:main").emitClose();
         const callback = vi.fn(() => "dropOldest");
         connections[0].onOverflow(callback);

         sendMany(connections[1].send, 4);

         expect(callback).not.toHaveBeenCalled();
      });

      it("uses only the callback of the channel for the queue that waits for a connection", () => {
         const { ipc } = loadPage();
         const ofChannel = vi.fn(() => "dropOldest");
         ipc.logTail.onOverflow(ofChannel);

         sendMany(ipc.logTail.send, 4);

         expect(ofChannel).toHaveBeenCalledOnce();
      });

      it("applies a callback that is set later to the queues that exist", () => {
         const { ipc, connection } = loadConnection();
         sendMany(connection.send, 4);
         const callback = vi.fn(() => "dropOldest");

         ipc.logTail.onOverflow(callback);
         connection.send("m5");

         expect(callback).toHaveBeenCalledOnce();
      });
   });

   describe("the warnings", () => {
      /** Sends to `nobody`, which has a maxQueue of 0, so that every message is dropped. */
      function dropMany(count: number, send: (...args: unknown[]) => void) {
         sendMany(send, count);
      }

      it("warns at the first drop, not again until the 100th, and then at every 100th", () => {
         const { ipc } = loadPage();

         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(1);
         dropMany(98, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(1);
         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(2);
         dropMany(99, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(2);
         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(3);
         dropMany(100, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(4);
      });

      it("names the channel and the limit, and gives the counts", () => {
         const { ipc } = loadPage();

         dropMany(100, ipc.nobody.send);

         const [first] = warn.mock.calls[0];
         const [second] = warn.mock.calls[1];
         expect(first).toContain("'nobody'");
         expect(first).toContain("maxQueue 0");
         expect(first).toContain("messages are being dropped");
         expect(first).toContain("Dropped so far: 1.");
         expect(first).toContain("Warnings so far: 1.");
         expect(second).toContain("Dropped so far: 100.");
         expect(second).toContain("Warnings so far: 2.");
      });

      it("hands the counts to the callback", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.nobody.onOverflow(callback);

         dropMany(101, ipc.nobody.send);

         const infos = callback.mock.calls.map(([, info]) => info);
         expect(infos[0]).toStrictEqual({ channel: "nobody", max: 0, dropped: 0, warnings: 0 });
         expect(infos[1]).toStrictEqual({ channel: "nobody", max: 0, dropped: 1, warnings: 1 });
         expect(infos[99]).toStrictEqual({ channel: "nobody", max: 0, dropped: 99, warnings: 1 });
         expect(infos[100]).toStrictEqual({ channel: "nobody", max: 0, dropped: 100, warnings: 2 });
      });

      it("does not reset the counts when a queue drains and overflows again", () => {
         const { ipc, pair, end } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);
         sendMany(ipc.chat.send, 3);
         pair("chat");
         end("chat");

         sendMany(ipc.chat.send, 3, "again");

         expect(callback.mock.calls[1][1]).toStrictEqual({
            channel: "chat",
            max: 2,
            dropped: 1,
            warnings: 1,
         });
         // The second drop is not the first, and not the 100th.
         expect(warn).toHaveBeenCalledOnce();
      });

      it("counts per queue, so every connection warns for its own first drop", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.nobody.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("nobody", "1:main").emitClose();
         loaded.pair("nobody", "2:main").emitClose();

         connections[0].send("a");
         connections[1].send("b");

         expect(warn).toHaveBeenCalledTimes(2);
      });
   });
});

// ---------------------------------------------------------------------------------------------
// The main process
// ---------------------------------------------------------------------------------------------

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent. */
function createContents(loading = false) {
   const contents = Object.assign(new EventEmitter(), {
      loading,
      destroyed: false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => "app://.",
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}
type FakeContents = ReturnType<typeof createContents>;

class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

const channelsMade: { port1: FakePortMain; port2: object }[] = [];

class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = {};
   constructor() {
      channelsMade.push(this);
   }
}

/** Loads the generated main process, and returns its exports. */
function loadMain() {
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannelMain };
   return loadGenerated(project.generated["main.ts"], { electron });
}

/** Lets the page finish loading, so that the connection gets its port. */
function finishLoading(contents: FakeContents) {
   contents.loading = false;
   contents.emit("did-finish-load");
}

const lastPort = () => channelsMade[channelsMade.length - 1].port1;
const flushed = () => messages(lastPort().postMessage);

/** A connection of `channel` whose page has not loaded, so that `send` queues. */
function connectWaiting(main: any, channel: string) {
   const contents = createContents(true);
   const connection = main.ipc[channel].connect(contents);
   return { contents, connection };
}

describe("the send queue of a mainPort connection in the main process", () => {
   describe("before the page has loaded", () => {
      it("keeps the newest maxQueue messages, and flushes them in order when the port is there", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 5);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(3, 5));
      });

      it("drops the oldest message by default, and warns once", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 5);

         expect(warn).toHaveBeenCalledOnce();
         expect(error).not.toHaveBeenCalled();
      });

      it("queues nothing for a maxQueue of 0", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 4);
         finishLoading(contents);

         expect(flushed()).toStrictEqual([]);
      });

      it("never drops for a maxQueue of Infinity, and never warns", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "frames");

         sendMany(connection.send, 3000);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(1, 3000));
         expect(warn).not.toHaveBeenCalled();
      });

      it("holds 1000 messages when the channel sets no maxQueue", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "defaulted");

         sendMany(connection.send, 1001);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 1001));
      });

      it("keeps a queue per connection", () => {
         const main = loadMain();
         const one = connectWaiting(main, "logTail");
         const two = connectWaiting(main, "logTail");

         sendMany(one.connection.send, 4, "one");
         sendMany(two.connection.send, 2, "two");
         finishLoading(one.contents);
         const first = flushed();
         finishLoading(two.contents);

         expect(first).toStrictEqual(range(2, 4, "one"));
         expect(flushed()).toStrictEqual(range(1, 2, "two"));
      });
   });

   describe("after the port has closed while the contents are alive", () => {
      it("queues again, and takes new messages once the queue has drained", () => {
         const main = loadMain();
         const contents = createContents();
         const connection = main.ipc.logTail.connect(contents);
         lastPort().emit("close");
         sendMany(connection.send, 4);
         const closed = lastPort();

         finishLoading(contents);
         lastPort().emit("close");
         sendMany(connection.send, 3, "later");
         finishLoading(contents);

         expect(closed.postMessage).not.toHaveBeenCalled();
         expect(messages(channelsMade[1].port1.postMessage)).toStrictEqual(range(2, 4));
         expect(flushed()).toStrictEqual(range(1, 3, "later"));
      });

      it("drops what is queued when the connection is closed", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "logTail");
         sendMany(connection.send, 2);

         connection.close();
         sendMany(connection.send, 2, "after");
         finishLoading(contents);

         expect(channelsMade).toHaveLength(0);
      });
   });

   describe("the overflow callback", () => {
      /** A connection whose queue holds m1, m2 and m3, with the callback of the test. */
      function loadFull(callback: ((...args: any[]) => unknown) | undefined, global = true) {
         const main = loadMain();
         const waiting = connectWaiting(main, "logTail");
         if (callback && global) {
            main.configurePorts({ onOverflow: callback });
         } else if (callback) {
            waiting.connection.onOverflow(callback);
         }
         sendMany(waiting.connection.send, 3);
         return { main, ...waiting };
      }

      it("gets the queue, the new message and the info", () => {
         const callback = vi.fn((queue: unknown[][]) => queue);
         const { connection } = loadFull(callback);

         connection.send("m4", 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0]).toStrictEqual([
            range(1, 3),
            ["m4", 2],
            { channel: "logTail", max: 3, dropped: 0, warnings: 0 },
         ]);
      });

      it("keeps what it returns: dropping the oldest", () => {
         const { contents, connection } = loadFull((queue, message) => [
            ...queue.slice(1),
            message,
         ]);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("keeps what it returns: dropping the newest", () => {
         const { contents, connection } = loadFull((queue) => queue);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(1, 3));
      });

      it("keeps what it returns: clearing", () => {
         const { contents, connection } = loadFull(() => []);

         connection.send("m4");
         connection.send("m5");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(5, 5));
      });

      it("keeps what it returns: coalescing the waiting messages", () => {
         const { contents, connection } = loadFull((queue, message) => [
            [`${queue.map(([text]) => text).join("+")}+${message[0]}`],
         ]);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual([["m1+m2+m3+m4"]]);
      });

      it("drops the oldest of a list that is longer than maxQueue, and counts them", () => {
         const callback = vi.fn((queue: unknown[][], message: unknown[], _info: any) => [
            ...queue,
            message,
            ["extra"],
         ]);
         const { contents, connection } = loadFull(callback);

         connection.send("m4");
         connection.send("m5");
         finishLoading(contents);

         // m4 and extra were kept with m3. m5 and the extra after it replaced m3 and m4.
         expect(flushed()).toStrictEqual([["extra"], ["m5"], ["extra"]]);
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 2]);
      });

      it("counts the waiting messages and the new one that it left out", () => {
         const callback = vi.fn((..._args: any[]) => []);
         const { connection } = loadFull(callback);

         connection.send("m4");
         sendMany(connection.send, 4, "n");

         // The first call left out m1 to m4. The queue then filled up again, and overflowed.
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 4]);
      });

      it("drops the oldest and logs when it does not return an array", () => {
         const { contents, connection } = loadFull(() => "dropOldest");

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(String(error.mock.calls[0][0])).toMatch(/'logTail'.*must return an array/);
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("drops the oldest and logs when the array holds something that is not a message", () => {
         const { contents, connection } = loadFull((queue) => [...queue, "m4"]);

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("drops the oldest and logs when it throws", () => {
         const failure = new Error("boom");
         const { contents, connection } = loadFull(() => {
            throw failure;
         });

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("hands over a copy, so that a callback which fails halfway leaves the queue as it was", () => {
         const { contents, connection } = loadFull((queue) => {
            queue.length = 0;
            throw new Error("boom");
         });

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("does not keep a list that the callback returns, which it may change later", () => {
         const kept: unknown[][] = [["k1"]];
         const { contents, connection } = loadFull(() => kept);

         connection.send("m4");
         kept.push(["k2"]);
         finishLoading(contents);

         expect(flushed()).toStrictEqual([["k1"]]);
      });

      it("is called for every message when maxQueue is 0, with an empty queue", () => {
         const main = loadMain();
         const callback = vi.fn((queue: unknown[][], message: unknown[]) => [...queue, message]);
         main.configurePorts({ onOverflow: callback });
         const { contents, connection } = connectWaiting(main, "meters");

         connection.send(1);
         connection.send(2);
         finishLoading(contents);

         expect(callback.mock.calls.map(([queue]) => queue)).toStrictEqual([[], []]);
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 1]);
         // What it wanted to keep does not fit.
         expect(flushed()).toStrictEqual([]);
      });

      it("is not called while the queue has room", () => {
         const main = loadMain();
         const callback = vi.fn();
         main.configurePorts({ onOverflow: callback });
         const { connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 3);

         expect(callback).not.toHaveBeenCalled();
      });
   });

   describe("the registration of the overflow callback", () => {
      it("uses the callback of the connection over the global one", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         connection.onOverflow(own);

         sendMany(connection.send, 4);

         expect(global).not.toHaveBeenCalled();
         expect(own).toHaveBeenCalledOnce();
      });

      it("goes back to the global callback when onOverflow(undefined) removes the override", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         connection.onOverflow(own);

         connection.onOverflow(undefined);
         sendMany(connection.send, 4);

         expect(global).toHaveBeenCalledOnce();
         expect(own).not.toHaveBeenCalled();
      });

      it("goes back to the global callback when the disposer removes the override", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         const dispose = connection.onOverflow(own);

         dispose();
         sendMany(connection.send, 4);

         expect(global).toHaveBeenCalledOnce();
      });

      it("replaces the previous override, whose disposer then removes nothing", () => {
         const main = loadMain();
         const first = vi.fn((queue: unknown[][]) => queue);
         const second = vi.fn((queue: unknown[][]) => queue);
         const { connection } = connectWaiting(main, "logTail");
         const disposeFirst = connection.onOverflow(first);
         connection.onOverflow(second);

         disposeFirst();
         sendMany(connection.send, 4);

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledOnce();
      });

      it("keeps the override of a connection apart from the other connections", () => {
         const main = loadMain();
         const own = vi.fn((queue: unknown[][]) => queue);
         const one = connectWaiting(main, "logTail");
         const two = connectWaiting(main, "logTail");
         one.connection.onOverflow(own);

         sendMany(two.connection.send, 4);

         expect(own).not.toHaveBeenCalled();
      });

      it("applies the global callback to connections that exist, and to every channel", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const tail = connectWaiting(main, "logTail");
         const defaulted = connectWaiting(main, "defaulted");
         main.configurePorts({ onOverflow: global });

         sendMany(tail.connection.send, 4);
         sendMany(defaulted.connection.send, 1001);

         expect(global.mock.calls.map(([, , info]) => info.channel)).toStrictEqual([
            "logTail",
            "defaulted",
         ]);
      });

      it("removes the global callback with configurePorts({})", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         main.configurePorts({});
         const { contents, connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 4);
         finishLoading(contents);

         expect(global).not.toHaveBeenCalled();
         expect(flushed()).toStrictEqual(range(2, 4));
      });
   });

   describe("the warnings", () => {
      it("warns at the first drop, not again until the 100th, and then at every 100th", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "meters");
         const send = (count: number) => sendMany(connection.send, count);

         send(1);
         expect(warn).toHaveBeenCalledTimes(1);
         send(98);
         expect(warn).toHaveBeenCalledTimes(1);
         send(1);
         expect(warn).toHaveBeenCalledTimes(2);
         send(99);
         expect(warn).toHaveBeenCalledTimes(2);
         send(1);
         expect(warn).toHaveBeenCalledTimes(3);
      });

      it("names the channel and the limit, and gives the counts", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 100);

         const [first] = warn.mock.calls[0];
         const [second] = warn.mock.calls[1];
         expect(first).toContain("'meters'");
         expect(first).toContain("maxQueue 0");
         expect(first).toContain("messages are being dropped");
         expect(first).toContain("Dropped so far: 1.");
         expect(first).toContain("Warnings so far: 1.");
         expect(second).toContain("Dropped so far: 100.");
         expect(second).toContain("Warnings so far: 2.");
      });

      it("hands the counts to the callback", () => {
         const main = loadMain();
         const callback = vi.fn(() => []);
         main.configurePorts({ onOverflow: callback });
         const { connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 101);

         const infos = callback.mock.calls.map((call: unknown[]) => call[2]);
         expect(infos[0]).toStrictEqual({ channel: "meters", max: 0, dropped: 0, warnings: 0 });
         expect(infos[1]).toStrictEqual({ channel: "meters", max: 0, dropped: 1, warnings: 1 });
         expect(infos[100]).toStrictEqual({ channel: "meters", max: 0, dropped: 100, warnings: 2 });
      });

      it("does not reset the counts when a queue drains and overflows again", () => {
         const main = loadMain();
         const callback = vi.fn((queue: unknown[][], message: unknown[], _info: any) => [
            ...queue.slice(1),
            message,
         ]);
         main.configurePorts({ onOverflow: callback });
         const { contents, connection } = connectWaiting(main, "logTail");
         sendMany(connection.send, 4);
         finishLoading(contents);
         lastPort().emit("close");

         sendMany(connection.send, 4, "again");

         expect(callback.mock.calls[1][2]).toStrictEqual({
            channel: "logTail",
            max: 3,
            dropped: 1,
            warnings: 1,
         });
         expect(warn).toHaveBeenCalledOnce();
      });

      it("counts per connection, so each one warns for its own first drop", () => {
         const main = loadMain();
         const one = connectWaiting(main, "meters");
         const two = connectWaiting(main, "meters");

         one.connection.send("a");
         two.connection.send("b");

         expect(warn).toHaveBeenCalledTimes(2);
      });
   });
});

// ---------------------------------------------------------------------------------------------
// The generated files
// ---------------------------------------------------------------------------------------------

describe("the generated files of channels with a maxQueue", () => {
   it("type-checks the options, the callbacks and the misuse of them", async () => {
      expect(await project.typecheck()).toBe("");
   });

   it("type-checks under noUnusedLocals, which the helpers must satisfy", async () => {
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
   });

   it("exposes onOverflow on the channel and on every connection of the page", () => {
      const { ipc, pair } = loadPage();
      const connections: any[] = [];
      ipc.chat.onConnection((connection: unknown) => connections.push(connection));

      pair("chat");

      expect(typeof ipc.chat.onOverflow).toBe("function");
      expect(typeof connections[0].onOverflow).toBe("function");
   });

   it("declares the overflow types in window.d.ts and the exports of main.ts", () => {
      const windowTypes = project.generated["window.d.ts"];
      const main = project.generated["main.ts"];

      expect(windowTypes).toContain("interface IpcPortOverflowInfo {");
      expect(windowTypes).toContain(
         "type IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';",
      );
      expect(windowTypes).toContain(
         "onOverflow: (callback: (message: Parameters<(line: string, level?: number) => void>, info: IpcPortOverflowInfo) => IpcPortOverflowAction) => () => void;",
      );
      expect(main).toContain("export interface PortOverflowInfo {");
      expect(main).toContain("export function configurePorts(config: PortsConfig): void {");
   });

   it("writes the maxQueue of each channel into both scripts", () => {
      const main = project.generated["main.ts"];
      const preload = project.generated["preload.ts"];

      expect(main).toContain("connectMainPort('autoipc:logTail', 'logTail', 3, target)");
      expect(main).toContain("connectMainPort('autoipc:meters', 'meters', 0, target)");
      expect(main).toContain("connectMainPort('autoipc:frames', 'frames', Infinity, target)");
      expect(main).toContain("connectMainPort('autoipc:defaulted', 'defaulted', 1000, target)");
      expect(preload).toContain("createPortChannel('chat', 'autoipc:chat', 2)");
      expect(preload).toContain("createPortChannel('nobody', 'autoipc:nobody', 0)");
      expect(preload).toContain("createPortChannel('plain', 'autoipc:plain', 1000)");
      expect(preload).toContain("createPortChannel('frames', 'autoipc:frames', Infinity)");
   });
});
