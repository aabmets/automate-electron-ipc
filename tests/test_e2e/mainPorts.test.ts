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
   abortNavigation,
   createFakeElectron,
   createFakePreloadElectron,
   failLoading,
   finishLoading,
   loadGenerated,
   settlePorts,
   startLoading,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const closeWire = (name: string) => `autoipc:${name}:close`;
const disconnectWire = (name: string) => `autoipc:${name}:disconnect`;

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

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent to it. */
function createContents(state: { loading?: boolean; url?: string } = {}) {
   const contents = Object.assign(new EventEmitter(), {
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

/** A `MessagePortMain`: an emitter with the methods of the generated code, and records of them. */
class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

/** The ports a `MessageChannelMain` made, in order. */
const channelsMade: { port1: FakePortMain; port2: object }[] = [];

class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = { name: `port2 of ${channelsMade.length + 1}` };
   constructor() {
      channelsMade.push(this);
   }
}

async function loadMainWithElectron(channelClass: unknown = FakeChannelMain) {
   project = await runFixture("main-port");
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass };
   return { electron, ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc };
}

async function loadMain() {
   return (await loadMainWithElectron()).ipc;
}

/** The listener that the main process registered for the page which ends a connection. */
function disconnectListener(electron: ReturnType<typeof createFakeElectron>) {
   const call = electron.ipcMain.on.mock.calls.find(
      ([channel]: [string]) => channel === disconnectWire("logTail"),
   );
   return call?.[1] as (event: { sender: unknown }, key: unknown) => void;
}

/** The main port of the last pair that was made. */
const lastPort = () => channelsMade[channelsMade.length - 1].port1;

/** Delivers a message from the page to the main port, the way Electron does. */
const fromPage = (port: FakePortMain, data: unknown) => port.emit("message", { data });

describe("ipc.<name>.connect of a mainPort channel", () => {
   it("pairs at once when the page has loaded, keeps port1 and posts port2 with the key", async () => {
      const ipc = await loadMain();
      const contents = createContents();

      ipc.logTail.connect({ webContents: contents });

      expect(channelsMade).toHaveLength(1);
      expect(lastPort().start).toHaveBeenCalledOnce();
      expect(contents.postMessage).toHaveBeenCalledExactlyOnceWith(wire("logTail"), "1:main", [
         channelsMade[0].port2,
      ]);
   });

   it("takes a window, a view and contents alike", async () => {
      const ipc = await loadMain();
      const [a, b, c] = [createContents(), createContents(), createContents()];

      ipc.logTail.connect({ webContents: a });
      ipc.logTail.connect({ webContents: b });
      ipc.logTail.connect(c);

      for (const contents of [a, b, c]) {
         expect(contents.postMessage).toHaveBeenCalledOnce();
      }
   });

   it("posts nothing until the page has loaded, then pairs on the load", async () => {
      const ipc = await loadMain();
      const contents = createContents({ loading: true });

      ipc.logTail.connect(contents);
      expect(channelsMade).toHaveLength(0);
      expect(contents.postMessage).not.toHaveBeenCalled();

      finishLoading(contents);

      expect(contents.postMessage).toHaveBeenCalledOnce();
      expect(channelsMade).toHaveLength(1);
   });

   // Electron keeps `isLoading()` true while `did-finish-load` fires, and after `loadURL` resolved.
   describe("while Electron still reports that the contents are loading", () => {
      it("pairs on did-finish-load, and flushes the queue", async () => {
         const ipc = await loadMain();
         const contents = createContents({ url: "" });
         const connection = ipc.logTail.connect(contents);
         connection.send("queued");

         contents.url = "app://.";
         startLoading(contents);
         contents.emit("did-finish-load");

         expect(contents.isLoading()).toBe(true);
         expect(contents.postMessage).toHaveBeenCalledOnce();
         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["queued"]]]);
      });

      it("pairs once per load, not again at the did-stop-loading that follows did-finish-load", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         ipc.logTail.connect(contents);

         startLoading(contents);
         finishLoading(contents);

         expect(channelsMade).toHaveLength(2);
         expect(contents.postMessage).toHaveBeenCalledTimes(2);
      });

      it("waits for did-stop-loading when connected right after did-finish-load, then pairs once", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         startLoading(contents);
         contents.emit("did-finish-load");

         const connection = ipc.logTail.connect(contents);
         connection.send("queued");
         expect(contents.postMessage).not.toHaveBeenCalled();

         contents.loading = false;
         contents.emit("did-stop-loading");
         contents.emit("did-stop-loading");

         expect(contents.postMessage).toHaveBeenCalledOnce();
         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["queued"]]]);
      });

      it("pairs a page that reloaded, and does not pair on the stop of a failed load", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         onReady.mockClear();

         startLoading(contents);
         finishLoading(contents);
         expect(onReady).toHaveBeenCalledOnce();

         startLoading(contents);
         contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "app://x", true);
         contents.loading = false;
         contents.emit("did-stop-loading");
         expect(onReady).toHaveBeenCalledOnce();
      });

      it("does not pair the error page of a failed load, and pairs the next page that loads", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true, url: "" });
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         connection.send("queued");

         startLoading(contents);
         failLoading(contents);
         expect(onReady).not.toHaveBeenCalled();
         expect(contents.postMessage).not.toHaveBeenCalled();

         startLoading(contents);
         finishLoading(contents);
         expect(onReady).toHaveBeenCalledOnce();
         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("does not pair the error page of a load that fails after a page was loaded", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         onReady.mockClear();

         startLoading(contents);
         failLoading(contents);
         expect(onReady).not.toHaveBeenCalled();

         startLoading(contents);
         finishLoading(contents);
         expect(onReady).toHaveBeenCalledOnce();
      });

      it("leaves the page alone when a navigation of it starts and stops without a commit", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         const onClose = vi.fn();
         connection.onReady(onReady);
         connection.onClose(onClose);
         onReady.mockClear();
         const made = channelsMade.length;

         abortNavigation(contents);
         abortNavigation(contents);

         expect(onReady).not.toHaveBeenCalled();
         expect(onClose).not.toHaveBeenCalled();
         expect(channelsMade).toHaveLength(made);
         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("keeps the page that was loaded when a navigation is aborted with a failure", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         onReady.mockClear();

         startLoading(contents);
         contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "app://x", true);
         contents.loading = false;
         contents.emit("did-stop-loading");
         expect(onReady).not.toHaveBeenCalled();

         startLoading(contents);
         finishLoading(contents);
         expect(onReady).toHaveBeenCalledOnce();
      });

      it("does not pair again when only a subframe, or only the document, navigates", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         ipc.logTail.connect(contents);

         contents.loading = true;
         contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
         contents.emit("did-frame-navigate", {}, "app://frame", 200, "OK", false);
         contents.loading = false;
         contents.emit("did-stop-loading");
         contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
         contents.emit("did-navigate-in-page", {}, "app://page#x", true);
         contents.emit("did-stop-loading");

         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("stops listening to the contents when the connection is closed", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         ipc.logTail.connect(contents).close();

         for (const event of [
            "did-navigate",
            "did-fail-load",
            "did-finish-load",
            "did-stop-loading",
         ]) {
            expect(contents.listenerCount(event)).toBe(0);
         }
      });
   });

   it("treats contents without a page as not loaded", async () => {
      const ipc = await loadMain();
      const blank = createContents({ url: "" });

      ipc.logTail.connect(blank);

      expect(blank.postMessage).not.toHaveBeenCalled();
   });

   it("gives every connection its own key, also for the same contents", async () => {
      const ipc = await loadMain();
      const contents = createContents();

      ipc.logTail.connect(contents);
      ipc.logTail.connect(contents);

      const keys = contents.postMessage.mock.calls.map(([, key]) => key);
      expect(keys).toStrictEqual(["1:main", "2:main"]);
   });

   it("uses the channel prefix of the config for the name that Electron sees", async () => {
      const { ipc } = await loadMainWithElectron();
      const contents = createContents();

      ipc.logTail.connect(contents);

      expect(contents.postMessage.mock.calls[0][0]).toBe("autoipc:logTail");
   });

   describe("a page which reloads", () => {
      // Regression for B9: a port that was posted once was lost when the page loaded again.
      it("gets a fresh port on every load, and the old port is closed", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         ipc.logTail.connect(contents);
         const first = lastPort();

         contents.emit("did-finish-load");

         expect(channelsMade).toHaveLength(2);
         expect(first.close).toHaveBeenCalledOnce();
         expect(lastPort().start).toHaveBeenCalledOnce();
         // The same key, so the page knows it is the same connection.
         expect(contents.postMessage.mock.calls.map(([, key]) => key)).toStrictEqual([
            "1:main",
            "1:main",
         ]);
      });

      it("does not tell the onClose subscribers about the replaced port, but runs onReady again", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         const onClose = vi.fn();
         connection.onReady(onReady);
         connection.onClose(onClose);
         const first = lastPort();

         contents.emit("did-finish-load");
         // The old port closes later, and the connection is not over.
         first.emit("close");

         expect(onReady).toHaveBeenCalledTimes(2);
         expect(onClose).not.toHaveBeenCalled();
      });

      it("hears only the port that is current", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const heard = vi.fn();
         connection.on(heard);
         const first = lastPort();

         contents.emit("did-finish-load");
         fromPage(first, ["stale"]);
         fromPage(lastPort(), ["fresh"]);

         expect(heard.mock.calls).toStrictEqual([["fresh"]]);
      });
   });

   describe("send", () => {
      it("queues the messages until the page has loaded, then flushes them in order", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);

         connection.send("one");
         connection.send("two", 2);
         finishLoading(contents);
         connection.send("three");

         expect(lastPort().postMessage.mock.calls).toStrictEqual([
            [["one"]],
            [["two", 2]],
            [["three"]],
         ]);
      });

      it("flushes the queue before it runs the onReady subscribers, so that their sends come last", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         connection.onReady(() => connection.send("from onReady"));
         connection.send("queued");

         finishLoading(contents);

         expect(lastPort().postMessage.mock.calls).toStrictEqual([
            [["queued"]],
            [["from onReady"]],
         ]);
      });

      it("flushes a queue only once", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         connection.send("once");
         finishLoading(contents);
         contents.emit("did-finish-load");

         expect(channelsMade[0].port1.postMessage).toHaveBeenCalledOnce();
         expect(channelsMade[1].port1.postMessage).not.toHaveBeenCalled();
      });

      it("queues again while the connection has no port, such as after the page went away", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const first = lastPort();
         first.emit("close");

         connection.send("while away");
         expect(first.postMessage).not.toHaveBeenCalled();
         contents.emit("did-finish-load");

         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["while away"]]]);
      });

      it("reports a message which cannot be cloned, and still sends the others", async () => {
         class FailingChannel extends FakeChannelMain {
            constructor() {
               super();
               this.port1.postMessage.mockImplementation(([text]: string[]) => {
                  if (text === "bad") {
                     throw new Error("An object could not be cloned");
                  }
               });
            }
         }
         const { ipc } = await loadMainWithElectron(FailingChannel);
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const onReady = vi.fn();
         connection.onReady(onReady);
         connection.send("bad");
         connection.send("fine");

         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["bad"]], [["fine"]]]);
         expect(onReady).toHaveBeenCalledOnce();
      });
   });

   describe("on", () => {
      it("hands the arguments that the page sent to every subscriber, each with its own disposer", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const first = vi.fn();
         const second = vi.fn();
         const stopFirst = connection.on(first);
         connection.on(second);

         fromPage(lastPort(), ["line", 3]);
         stopFirst();
         fromPage(lastPort(), ["next"]);

         expect(first.mock.calls).toStrictEqual([["line", 3]]);
         expect(second.mock.calls).toStrictEqual([["line", 3], ["next"]]);
      });

      it("treats the same callback twice as two subscriptions", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         const stop = connection.on(callback);
         connection.on(callback);

         stop();
         fromPage(lastPort(), ["x"]);

         expect(callback).toHaveBeenCalledOnce();
      });

      it("ignores a message which is not an argument list", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         connection.on(callback);

         fromPage(lastPort(), "text");
         fromPage(lastPort(), { length: 1, 0: "x" });
         fromPage(lastPort(), null);

         expect(callback).not.toHaveBeenCalled();
      });

      it("reports a subscriber which throws, and still tells the others", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const failure = new Error("boom");
         const after = vi.fn();
         connection.on(() => {
            throw failure;
         });
         connection.on(after);

         fromPage(lastPort(), ["x"]);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(after).toHaveBeenCalledOnce();
      });

      it("lets a subscriber stop itself while the others are told", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const after = vi.fn();
         const stop = connection.on(() => stop());
         connection.on(after);

         fromPage(lastPort(), ["x"]);
         fromPage(lastPort(), ["y"]);

         expect(after).toHaveBeenCalledTimes(2);
      });
   });

   describe("onReady and onClose", () => {
      it("runs onReady at once when a port is there, and not when there is none", async () => {
         const ipc = await loadMain();
         const paired = ipc.logTail.connect(createContents());
         const waiting = ipc.logTail.connect(createContents({ loading: true }));
         const early = vi.fn();
         const late = vi.fn();

         paired.onReady(early);
         waiting.onReady(late);

         expect(early).toHaveBeenCalledOnce();
         expect(late).not.toHaveBeenCalled();
      });

      it("stops an onReady subscriber with its disposer", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const callback = vi.fn();
         const stop = connection.onReady(callback);

         stop();
         contents.emit("did-finish-load");

         expect(callback).toHaveBeenCalledOnce();
      });

      it("runs onClose when the port closes, such as when the page goes away", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         const stop = connection.onClose(callback);
         const other = vi.fn();
         connection.onClose(other);

         lastPort().emit("close");
         stop();
         lastPort().emit("close");

         expect(callback).toHaveBeenCalledOnce();
         expect(other).toHaveBeenCalledOnce();
      });

      it("reports an onClose subscriber which throws, and still tells the others", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const after = vi.fn();
         connection.onClose(() => {
            throw new Error("boom");
         });
         connection.onClose(after);

         lastPort().emit("close");

         expect(error).toHaveBeenCalledOnce();
         expect(after).toHaveBeenCalledOnce();
      });
   });

   describe("close", () => {
      it("tells the page, closes the port, runs onClose and pairs no more", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         const port = lastPort();

         connection.close();

         expect(contents.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         expect(port.close).toHaveBeenCalledOnce();
         expect(onClose).toHaveBeenCalledOnce();
         expect(contents.listenerCount("did-finish-load")).toBe(0);
         expect(contents.listenerCount("destroyed")).toBe(0);
         // A reload does not bring the connection back.
         contents.emit("did-finish-load");
         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("ends for good once, and drops the sends that come after it", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         const port = lastPort();

         connection.close();
         connection.close();
         connection.send("late");

         expect(contents.send).toHaveBeenCalledOnce();
         expect(onClose).toHaveBeenCalledOnce();
         expect(port.postMessage).not.toHaveBeenCalled();
      });

      it("does not run onClose when no port was there, but still ends the connection", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         connection.send("never sent");

         connection.close();
         finishLoading(contents);

         expect(onClose).not.toHaveBeenCalled();
         expect(channelsMade).toHaveLength(0);
         expect(contents.postMessage).not.toHaveBeenCalled();
      });

      it("ends the connection when the contents are destroyed, without sending to them", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);

         destroy(contents);
         connection.close();

         expect(onClose).toHaveBeenCalledOnce();
         expect(lastPort().close).toHaveBeenCalledOnce();
         expect(contents.send).not.toHaveBeenCalled();
      });

      it("keeps the other connections of the same channel", async () => {
         const ipc = await loadMain();
         const [one, two] = [createContents(), createContents()];
         const first = ipc.logTail.connect(one);
         ipc.logTail.connect(two);

         first.close();
         one.emit("did-finish-load");
         two.emit("did-finish-load");

         expect(one.postMessage).toHaveBeenCalledOnce();
         expect(two.postMessage).toHaveBeenCalledTimes(2);
         expect(two.send).not.toHaveBeenCalled();
      });
   });

   // Regression for T78, which found that `connect` of a `port` channel leaves entries behind when
   // its second window is destroyed. A `mainPort` channel takes one target, and resolves it first.
   describe("a target that was destroyed before connect", () => {
      const eventsOf = ["did-navigate", "did-fail-load", "did-finish-load", "did-stop-loading"];

      /** A window like the one of Electron: once it is destroyed, its `webContents` getter throws. */
      const destroyedWindow = () => ({
         get webContents(): never {
            throw new TypeError("Object has been destroyed");
         },
      });

      const leftOn = (contents: FakeContents) =>
         Object.fromEntries(eventsOf.map((event) => [event, contents.listenerCount(event)]));
      const noListeners = leftOn(createContents());

      it("throws Electron's own error for a destroyed window, and registers nothing", async () => {
         const ipc = await loadMain();
         ipc.logTail.connect(createContents());

         expect(() => ipc.logTail.connect(destroyedWindow())).toThrow(
            new TypeError("Object has been destroyed"),
         );

         // The window failed before it was given a key, so the next connection gets the next key.
         const live = createContents();
         ipc.logTail.connect(live);
         expect(live.postMessage.mock.calls[0].slice(0, 2)).toStrictEqual([
            wire("logTail"),
            "2:main",
         ]);
      });

      it("throws for contents that are destroyed, and registers nothing", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         ipc.logTail.connect(createContents());
         const contents = createContents();
         contents.destroyed = true;

         expect(() => ipc.logTail.connect(contents)).toThrow(
            new TypeError("Object has been destroyed"),
         );
         expect(leftOn(contents)).toStrictEqual(noListeners);

         // The key that it would have had does nothing, and the live connection is untouched.
         disconnectListener(electron)({ sender: contents }, "2:main");
         expect(contents.send).not.toHaveBeenCalled();
         const live = createContents();
         ipc.logTail.connect(live);
         expect(live.postMessage.mock.calls[0].slice(0, 2)).toStrictEqual([
            wire("logTail"),
            "2:main",
         ]);
      });

      it("removes what it registered when the setup fails", async () => {
         class FailingChannel {
            constructor() {
               throw new Error("no more ports");
            }
         }
         const { ipc } = await loadMainWithElectron(FailingChannel);
         const contents = createContents();

         expect(() => ipc.logTail.connect(contents)).toThrow("no more ports");

         expect(leftOn(contents)).toStrictEqual(noListeners);
         expect(contents.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         contents.emit("did-finish-load");
         expect(contents.postMessage).not.toHaveBeenCalled();
      });
   });

   describe("a page which ends its connection", () => {
      it("listens for it once for the channel, however many connections there are", async () => {
         const { ipc, electron } = await loadMainWithElectron();

         ipc.logTail.connect(createContents());
         ipc.logTail.connect(createContents());

         const calls = electron.ipcMain.on.mock.calls.filter(
            ([channel]: [string]) => channel === disconnectWire("logTail"),
         );
         expect(calls).toHaveLength(1);
      });

      it("ends the connection when the contents which hold the end ask", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const [one, two] = [createContents(), createContents()];
         const connection = ipc.logTail.connect(one);
         ipc.logTail.connect(two);
         const onClose = vi.fn();
         connection.onClose(onClose);

         disconnectListener(electron)({ sender: one }, "1:main");

         expect(onClose).toHaveBeenCalledOnce();
         expect(one.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         expect(two.send).not.toHaveBeenCalled();
         one.emit("did-finish-load");
         expect(one.postMessage).toHaveBeenCalledOnce();
      });

      it("ignores other contents, an unknown key and a key which is no text", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const contents = createContents();
         const stranger = createContents();
         ipc.logTail.connect(contents);
         const disconnect = disconnectListener(electron);

         disconnect({ sender: stranger }, "1:main");
         disconnect({ sender: contents }, "9:main");
         disconnect({ sender: contents }, 1);
         disconnect({ sender: contents }, undefined);
         disconnect({ sender: contents }, "__proto__");

         expect(contents.send).not.toHaveBeenCalled();
      });

      it("forgets the end of a connection once it is closed", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const contents = createContents();
         ipc.logTail.connect(contents).close();

         disconnectListener(electron)({ sender: contents }, "1:main");

         expect(contents.send).toHaveBeenCalledOnce();
      });
   });
});

describe("the generated files of a mainPort channel", () => {
   it("type-checks the usage of both sides", async () => {
      project = await runFixture("main-port");

      expect(await project.typecheck()).toBe("");
   });

   it("gives the page the API of a port channel, whichever peer the channel has", async () => {
      project = await runFixture("main-port");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      const members = (name: string) => Object.keys(fake.exposed.ipc[name]).sort();
      expect(members("logTail")).toStrictEqual(members("chat"));
      expect(members("logTail")).toStrictEqual([
         "on",
         "onClose",
         "onConnection",
         "onOverflow",
         "onReady",
         "send",
      ]);
      expect(project.generated["window.d.ts"]).toContain("logTail: {");
      expect(project.generated["window.d.ts"]).toContain(
         "send: (line: string, level?: number) => void;",
      );
   });

   it("has only the main-process helpers that its channels use", async () => {
      project = await runFixture("main-port");
      const main = project.generated["main.ts"];

      expect(main).toContain("function connectMainPort(");
      expect(main).toContain("function connectPorts(");
      expect(main.match(/const portEnds = /g)).toHaveLength(1);
   });
});

/**
 * A `MessagePortMain` over a real `MessagePort`: Electron's port reports `{ data }` to `message`
 * listeners and has `start()`, which this one maps to the web API.
 */
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
   const { electron, ipc: mainIpc } = await loadMainWithElectron(RealChannelMain);
   const fake = createFakePreloadElectron();
   if (!project) {
      throw new Error("The fixture was not generated");
   }
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const pageListener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   const contents = createContents();
   contents.postMessage.mockImplementation((channel: string, key: string, ports: unknown[]) =>
      pageListener(channel)({ ports }, key),
   );
   contents.send.mockImplementation((channel: string, key: string) =>
      pageListener(channel)({}, key),
   );
   fake.electron.ipcRenderer.send.mockImplementation((channel: string, key: string) => {
      if (channel === disconnectWire("logTail")) {
         disconnectListener(electron)({ sender: contents }, key);
      }
   });
   return { mainIpc, contents, page: fake.exposed.ipc.logTail };
}

/** Lets the messages and the events of the real ports arrive. */
const settle = () => settlePorts(20);

describe("a main process and a page over a real message channel", () => {
   it("sends in both directions, and queues until the page is connected", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      contents.loading = true;
      const connection = mainIpc.logTail.connect(contents);
      const fromMain: unknown[][] = [];
      const fromPage: unknown[][] = [];
      page.on((...args: unknown[]) => fromMain.push(args));
      connection.on((...args: unknown[]) => fromPage.push(args));

      connection.send("queued by main", 1);
      page.send("queued by page");
      finishLoading(contents);
      connection.send("live from main");
      page.send("live from page", 2);
      await settle();

      expect(fromMain).toStrictEqual([["queued by main", 1], ["live from main"]]);
      expect(fromPage).toStrictEqual([["queued by page"], ["live from page", 2]]);
   });

   it("shows the page the connection as one peer, which can answer on its own", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const answers: unknown[][] = [];
      connection.on((...args: unknown[]) => answers.push(args));
      page.onConnection((peer: { on: Function; send: Function }) => {
         peer.on((line: string) => peer.send(`echo ${line}`));
      });
      const echoed: unknown[][] = [];
      connection.on((...args: unknown[]) => echoed.push(args));

      connection.send("ping");
      await settle();

      expect(answers).toStrictEqual([["echo ping"]]);
      expect(echoed).toStrictEqual(answers);
   });

   it("keeps the connection through a reload of the page, with a new port", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const onReady = vi.fn();
      const heardByPage: unknown[][] = [];
      const heardByMain: unknown[][] = [];
      connection.onReady(onReady);
      page.on((...args: unknown[]) => heardByPage.push(args));
      connection.on((...args: unknown[]) => heardByMain.push(args));

      contents.emit("did-finish-load");
      connection.send("after reload");
      page.send("from the page");
      await settle();

      expect(onReady).toHaveBeenCalledTimes(2);
      expect(heardByPage).toStrictEqual([["after reload"]]);
      expect(heardByMain).toStrictEqual([["from the page"]]);
   });

   it("ends for the page when main closes the connection", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const pageClosed = vi.fn();
      page.onClose(pageClosed);
      const heard = vi.fn();
      page.on(heard);

      connection.close();
      connection.send("too late");
      await settle();

      expect(pageClosed).toHaveBeenCalledOnce();
      expect(heard).not.toHaveBeenCalled();
   });

   it("ends for main when the page closes the connection", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const mainClosed = vi.fn();
      connection.onClose(mainClosed);
      const peers: { close: () => void }[] = [];
      page.onConnection((peer: { close: () => void }) => peers.push(peer));

      peers[0].close();
      await settle();

      expect(mainClosed).toHaveBeenCalledOnce();
      // The connection is over, so a reload does not pair it again.
      contents.emit("did-finish-load");
      expect(contents.postMessage).toHaveBeenCalledOnce();
   });
});
