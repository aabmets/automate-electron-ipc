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
   commitNavigation,
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
const channels: MessageChannel[] = [];

afterEach(async () => {
   vi.restoreAllMocks();
   for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
   }
   await project?.cleanup();
   project = undefined;
});

/** A window which is loaded unless told otherwise, and whose contents are an emitter. */
function createWindow(state: { loading?: boolean; url?: string; destroyed?: boolean } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      loading: state.loading ?? false,
      url: state.url ?? "app://.",
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => win.destroyed,
   });
   const win = Object.assign(new EventEmitter(), {
      destroyed: state.destroyed ?? false,
      webContents: contents,
      isDestroyed: () => win.destroyed,
   });
   return win;
}
type FakeWindow = ReturnType<typeof createWindow>;

/** A window like the one of Electron: once it is destroyed, its `webContents` getter throws. */
function createStrictWindow(state: Parameters<typeof createWindow>[0] = {}) {
   const win = createWindow(state);
   const contents = win.webContents;
   Object.defineProperty(win, "webContents", {
      get() {
         if (win.destroyed) {
            throw new TypeError("Object has been destroyed");
         }
         return contents;
      },
   });
   return win;
}

/** The events that `connect` listens to on a window and on its contents. */
const loadEvents = ["did-navigate", "did-fail-load", "did-finish-load", "did-stop-loading"];

/** How many listeners `connect` has left on a window and on its contents. */
function listenersOn(win: FakeWindow) {
   return {
      closed: win.listenerCount("closed"),
      ...Object.fromEntries(
         loadEvents.map((event) => [event, win.webContents.listenerCount(event)]),
      ),
   };
}
const noListeners = listenersOn(createWindow());

/** Destroys a window the way Electron does: it emits `closed` once it can no longer be used. */
function destroy(win: FakeWindow) {
   win.destroyed = true;
   win.emit("closed");
}

/** The wire names and ports of the messages that were posted to a window, in order. */
const posted = (win: FakeWindow) => win.webContents.postMessage.mock.calls;

async function loadMain() {
   return (await loadMainWithElectron()).ipc;
}

/** Loads the generated main process, and returns the fake `electron` it was given as well. */
async function loadMainWithElectron(channelClass?: unknown) {
   project = await runFixture("port-only");
   let created = 0;
   class FakeChannel {
      id = ++created;
      port1 = { name: `port1 of ${this.id}` };
      port2 = { name: `port2 of ${this.id}` };
   }
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass ?? FakeChannel };
   return { electron, ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc };
}

/** The listener that the main process registered for the page which ends a connection. */
function disconnectListener(electron: ReturnType<typeof createFakeElectron>) {
   const call = electron.ipcMain.on.mock.calls.find(
      ([channel]: [string]) => channel === disconnectWire("chat"),
   );
   return call?.[1] as (event: { sender: unknown }, key: unknown) => void;
}

describe("ipc.<name>.connect", () => {
   it("posts the ends at once when both windows have loaded, port1 to the first window", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();

      ipc.chat.connect(one, two);

      expect(posted(one)).toStrictEqual([[wire("chat"), "1:a", [{ name: "port1 of 1" }]]]);
      expect(posted(two)).toStrictEqual([[wire("chat"), "1:b", [{ name: "port2 of 1" }]]]);
   });

   // Regression for B9: the ports were posted only on `ready-to-show`, which a shown window
   // never emits again.
   it("does not wait for ready-to-show, which a window that is already shown has emitted", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();

      ipc.chat.connect(one, two);
      one.emit("ready-to-show");

      expect(posted(one)).toHaveLength(1);
      expect(posted(two)).toHaveLength(1);
   });

   it("posts nothing until both windows have loaded, then pairs on the load that was last", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const late = createWindow({ loading: true });

      ipc.chat.connect(one, late);
      expect(posted(one)).toHaveLength(0);

      // The first window loading again changes nothing while the other still loads.
      one.webContents.emit("did-finish-load");
      expect(posted(one)).toHaveLength(0);

      finishLoading(late.webContents);
      expect(posted(one)).toStrictEqual([[wire("chat"), "1:a", [{ name: "port1 of 1" }]]]);
      expect(posted(late)).toStrictEqual([[wire("chat"), "1:b", [{ name: "port2 of 1" }]]]);
   });

   it("treats a window without a page as not loaded", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const blank = createWindow({ url: "" });

      ipc.chat.connect(one, blank);
      expect(posted(one)).toHaveLength(0);

      blank.webContents.url = "app://.";
      blank.webContents.emit("did-finish-load");
      expect(posted(one)).toHaveLength(1);
      expect(posted(blank)).toHaveLength(1);
   });

   it("pairs again with new ports when either window reloads", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();
      ipc.chat.connect(one, two);

      one.webContents.emit("did-finish-load");
      two.webContents.emit("did-finish-load");

      expect(posted(one).map(([, , ports]) => ports)).toStrictEqual([
         [{ name: "port1 of 1" }],
         [{ name: "port1 of 2" }],
         [{ name: "port1 of 3" }],
      ]);
      expect(posted(two).map(([, , ports]) => ports)).toStrictEqual([
         [{ name: "port2 of 1" }],
         [{ name: "port2 of 2" }],
         [{ name: "port2 of 3" }],
      ]);
   });

   it("does not pair while a reload of either window has not finished", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();
      ipc.chat.connect(one, two);

      startLoading(two.webContents);
      commitNavigation(two.webContents);
      finishLoading(one.webContents);

      expect(posted(one)).toHaveLength(1);
      expect(posted(two)).toHaveLength(1);

      finishLoading(two.webContents);

      expect(posted(one)).toHaveLength(2);
      expect(posted(two)).toHaveLength(2);
   });

   // Electron keeps `isLoading()` true while `did-finish-load` fires, and after `loadURL` resolved.
   describe("while Electron still reports that the contents are loading", () => {
      /** A window whose page has called `did-finish-load`, but not `did-stop-loading` yet. */
      const finishing = () => {
         const win = createWindow();
         startLoading(win.webContents);
         win.webContents.emit("did-finish-load");
         return win;
      };

      it("pairs on did-finish-load, when both windows were connected before they loaded", async () => {
         const ipc = await loadMain();
         const one = createWindow({ url: "" });
         const two = createWindow({ url: "" });
         ipc.chat.connect(one, two);

         for (const win of [one, two]) {
            win.webContents.url = "app://.";
            startLoading(win.webContents);
            win.webContents.emit("did-finish-load");
            expect(win.webContents.isLoading()).toBe(true);
         }

         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);
      });

      it("pairs once per load, not again at the did-stop-loading that follows did-finish-load", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         ipc.chat.connect(one, two);
         startLoading(one.webContents);
         startLoading(two.webContents);
         commitNavigation(one.webContents);
         commitNavigation(two.webContents);

         finishLoading(one.webContents);
         expect(posted(one)).toHaveLength(1);

         finishLoading(two.webContents);
         expect(posted(one)).toHaveLength(2);
         expect(posted(two)).toHaveLength(2);
      });

      it("waits for did-stop-loading when connected right after did-finish-load, then pairs once", async () => {
         const ipc = await loadMain();
         const one = finishing();
         const two = finishing();

         ipc.chat.connect(one, two);
         expect(posted(one)).toHaveLength(0);

         one.webContents.loading = false;
         one.webContents.emit("did-stop-loading");
         expect(posted(one)).toHaveLength(0);

         two.webContents.loading = false;
         two.webContents.emit("did-stop-loading");
         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);

         two.webContents.emit("did-stop-loading");
         expect(posted(one)).toHaveLength(1);
      });

      it("does not pair on the stop of a main-frame load that failed", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const failing = createWindow();
         startLoading(failing.webContents);
         ipc.chat.connect(one, failing);

         failing.webContents.emit(
            "did-fail-load",
            {},
            -105,
            "ERR_NAME_NOT_RESOLVED",
            "app://x",
            true,
         );
         failing.webContents.loading = false;
         failing.webContents.emit("did-stop-loading");

         expect(posted(one)).toHaveLength(0);
         expect(posted(failing)).toHaveLength(0);
      });

      it("does not pair the error page of a failed load, and pairs when the next page loads", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const failing = createWindow();
         startLoading(failing.webContents);
         ipc.chat.connect(one, failing);

         failLoading(failing.webContents);
         expect(posted(one)).toHaveLength(0);
         expect(posted(failing)).toHaveLength(0);

         startLoading(failing.webContents);
         finishLoading(failing.webContents);
         expect(posted(one)).toHaveLength(1);
         expect(posted(failing)).toHaveLength(1);
      });

      it("does not pair the error page of a window that failed after it was paired", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         ipc.chat.connect(one, two);
         expect(posted(two)).toHaveLength(1);

         startLoading(two.webContents);
         failLoading(two.webContents);
         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);

         startLoading(two.webContents);
         finishLoading(two.webContents);
         expect(posted(one)).toHaveLength(2);
         expect(posted(two)).toHaveLength(2);
      });

      it("leaves the windows alone when a navigation starts and stops without a commit", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         const connection = ipc.chat.connect(one, two);
         const onClose = vi.fn();
         connection.onClose?.(onClose);

         abortNavigation(one.webContents);
         abortNavigation(two.webContents);

         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);
         expect(one.webContents.send).not.toHaveBeenCalled();
         expect(two.webContents.send).not.toHaveBeenCalled();
         expect(onClose).not.toHaveBeenCalled();
      });

      it("pairs on the stop of a load after a subframe failed to load", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         startLoading(two.webContents);
         ipc.chat.connect(one, two);

         two.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "app://frame", false);
         two.webContents.loading = false;
         two.webContents.emit("did-stop-loading");

         expect(posted(two)).toHaveLength(1);
      });

      it("does not pair again when only a subframe navigates", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         ipc.chat.connect(one, two);

         two.webContents.loading = true;
         two.webContents.emit("did-start-loading");
         two.webContents.emit("did-start-navigation", {
            isMainFrame: false,
            isSameDocument: false,
         });
         two.webContents.emit("did-frame-navigate", {}, "app://frame", 200, "OK", false);
         two.webContents.loading = false;
         two.webContents.emit("did-stop-loading");

         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);
      });

      it("does not pair again for a navigation inside the same document", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         ipc.chat.connect(one, two);

         two.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
         two.webContents.emit("did-navigate-in-page", {}, "app://page#x", true);
         two.webContents.emit("did-stop-loading");

         expect(posted(two)).toHaveLength(1);
      });

      // Node warns about more than ten listeners of one event (T87).
      it("adds one listener of each event to the windows, however many connections they share", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         const connections = Array.from({ length: 12 }, () => ipc.chat.connect(one, two));

         for (const win of [one, two]) {
            expect(listenersOn(win)).toStrictEqual({
               closed: 1,
               "did-navigate": 1,
               "did-fail-load": 1,
               "did-finish-load": 1,
               "did-stop-loading": 1,
            });
         }
         // The listeners stay while one connection is left, and the page of that one still pairs.
         for (const connection of connections.slice(0, 11)) {
            connection.close();
         }
         expect(listenersOn(one).closed).toBe(1);
         const before = posted(one).length;
         one.webContents.emit("did-finish-load");
         expect(posted(one)).toHaveLength(before + 1);

         // A window that is destroyed ends the connection that is left, with no listener behind.
         destroy(one);
         expect(listenersOn(one)).toStrictEqual(noListeners);
         expect(listenersOn(two)).toStrictEqual(noListeners);
      });

      it("stops listening to the contents when the connection is closed", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         const connection = ipc.chat.connect(one, two);

         connection.close();

         for (const event of [
            "did-navigate",
            "did-fail-load",
            "did-finish-load",
            "did-stop-loading",
         ]) {
            expect(one.webContents.listenerCount(event)).toBe(0);
            expect(two.webContents.listenerCount(event)).toBe(0);
         }
      });
   });

   it("does not post to a window that was destroyed before it loaded", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const gone = createWindow({ destroyed: true });

      ipc.chat.connect(one, gone);

      expect(posted(one)).toHaveLength(0);
      expect(posted(gone)).toHaveLength(0);
   });

   it("returns a handle which closes the connection: both windows are told, nothing pairs after", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();
      const connection = ipc.chat.connect(one, two);

      connection.close();

      expect(one.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"), "1:a");
      expect(two.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"), "1:b");
      expect(one.listenerCount("closed")).toBe(0);
      expect(one.webContents.listenerCount("did-finish-load")).toBe(0);
      expect(two.webContents.listenerCount("did-finish-load")).toBe(0);

      one.webContents.emit("did-finish-load");
      expect(posted(one)).toHaveLength(1);
      expect(posted(two)).toHaveLength(1);
   });

   it("closes only once, however often the handle is used", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();
      const connection = ipc.chat.connect(one, two);

      connection.close();
      connection.close();
      destroy(one);

      expect(one.webContents.send).toHaveBeenCalledOnce();
      expect(two.webContents.send).toHaveBeenCalledOnce();
   });

   it("closes a connection before its windows have loaded without telling a window that has no port", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const late = createWindow({ loading: true });
      const connection = ipc.chat.connect(one, late);

      connection.close();
      finishLoading(late.webContents);

      expect(posted(one)).toHaveLength(0);
      expect(posted(late)).toHaveLength(0);
   });

   it("ends the connection when a window is destroyed, and tells the other window", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();
      ipc.chat.connect(one, two);

      destroy(two);

      // The destroyed window cannot be reached, and has dropped its own listeners.
      expect(two.webContents.send).not.toHaveBeenCalled();
      expect(one.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"), "1:a");
      expect(one.webContents.listenerCount("did-finish-load")).toBe(0);
      expect(one.listenerCount("closed")).toBe(0);

      one.webContents.emit("did-finish-load");
      expect(posted(one)).toHaveLength(1);
   });

   it("keeps connections of the same channel apart", async () => {
      const ipc = await loadMain();
      const hub = createWindow();
      const first = createWindow();
      const second = createWindow();
      const toFirst = ipc.chat.connect(hub, first);
      ipc.chat.connect(hub, second);

      toFirst.close();

      expect(first.webContents.send).toHaveBeenCalledOnce();
      expect(second.webContents.send).not.toHaveBeenCalled();
      // The connection which is still open keeps pairing when the hub reloads.
      hub.webContents.emit("did-finish-load");
      expect(posted(second)).toHaveLength(2);
      expect(posted(first)).toHaveLength(1);
   });

   it("connects a window with itself through one set of listeners", async () => {
      const ipc = await loadMain();
      const win = createWindow();

      const connection = ipc.chat.connect(win, win);

      expect(win.webContents.listenerCount("did-finish-load")).toBe(1);
      expect(posted(win)).toHaveLength(2);
      connection.close();
      // Both ends of the connection are in this window, and each is told.
      expect(win.webContents.send.mock.calls).toStrictEqual([
         [closeWire("chat"), "1:a"],
         [closeWire("chat"), "1:b"],
      ]);
   });

   describe("a hub with several peers", () => {
      it("gives every connection its own keys, so that one page can tell its ports apart", async () => {
         const ipc = await loadMain();
         const hub = createWindow();
         const peers = [createWindow(), createWindow(), createWindow()];

         for (const peer of peers) {
            ipc.chat.connect(hub, peer);
         }

         expect(posted(hub).map(([, key]) => key)).toStrictEqual(["1:a", "2:a", "3:a"]);
         expect(peers.map((peer) => posted(peer).map(([, key]) => key))).toStrictEqual([
            ["1:b"],
            ["2:b"],
            ["3:b"],
         ]);
      });

      it("closes one peer without touching the others, which keep pairing", async () => {
         const ipc = await loadMain();
         const hub = createWindow();
         const [first, second, third] = [createWindow(), createWindow(), createWindow()];
         const toFirst = ipc.chat.connect(hub, first);
         ipc.chat.connect(hub, second);
         ipc.chat.connect(hub, third);

         toFirst.close();

         expect(hub.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:a"]]);
         expect(first.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:b"]]);
         expect(second.webContents.send).not.toHaveBeenCalled();
         expect(third.webContents.send).not.toHaveBeenCalled();
         // The hub reloads: only the open connections get a new port.
         hub.webContents.emit("did-finish-load");
         expect(posted(hub).map(([, key]) => key)).toStrictEqual([
            "1:a",
            "2:a",
            "3:a",
            "2:a",
            "3:a",
         ]);
         expect(posted(first)).toHaveLength(1);
      });

      it("ends the connection of a destroyed peer and no other", async () => {
         const ipc = await loadMain();
         const hub = createWindow();
         const [first, second] = [createWindow(), createWindow()];
         ipc.chat.connect(hub, first);
         ipc.chat.connect(hub, second);

         destroy(second);

         expect(hub.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "2:a"]]);
         expect(first.webContents.send).not.toHaveBeenCalled();
      });
   });

   // Regression for T78: the first end was registered before the `webContents` of the second
   // window was read, and that getter throws for a destroyed window.
   describe("a window that was destroyed before connect", () => {
      /** Makes a connection, which registers the listener for the pages, and returns what a test needs. */
      async function setup() {
         const { ipc, electron } = await loadMainWithElectron();
         ipc.chat.connect(createWindow(), createWindow());
         return { ipc, disconnect: disconnectListener(electron) };
      }

      /** Destroys a window the way Electron does: its getter throws from then on. */
      const gone = () => createStrictWindow({ destroyed: true });

      const leftOn = (win: FakeWindow) => listenersOn(win);

      it("throws Electron's own error and leaves nothing behind when the second window is destroyed", async () => {
         const { ipc, disconnect } = await setup();
         const live = createStrictWindow();

         expect(() => ipc.chat.connect(live, gone())).toThrow(
            new TypeError("Object has been destroyed"),
         );

         // The key of the first end would be 2:a, and the page of that window must not reach it.
         disconnect({ sender: live.webContents }, "2:a");
         expect(live.webContents.send).not.toHaveBeenCalled();
         expect(leftOn(live)).toStrictEqual(noListeners);
      });

      it("leaves nothing behind when the first window is destroyed", async () => {
         const { ipc, disconnect } = await setup();
         const live = createStrictWindow();

         expect(() => ipc.chat.connect(gone(), live)).toThrow(TypeError);

         disconnect({ sender: live.webContents }, "2:b");
         expect(live.webContents.send).not.toHaveBeenCalled();
         expect(leftOn(live)).toStrictEqual(noListeners);
      });

      it("leaves nothing behind when the same destroyed window is given twice", async () => {
         const { ipc } = await setup();
         const twice = gone();

         expect(() => ipc.chat.connect(twice, twice)).toThrow(TypeError);

         expect(twice.listenerCount("closed")).toBe(0);
      });

      it("posts nothing to the live window", async () => {
         const { ipc } = await setup();
         const live = createStrictWindow();

         expect(() => ipc.chat.connect(live, gone())).toThrow(TypeError);
         live.webContents.emit("did-finish-load");

         expect(posted(live)).toHaveLength(0);
      });

      it("still connects two live windows afterwards, with a key that was not used", async () => {
         const { ipc } = await setup();
         expect(() => ipc.chat.connect(createStrictWindow(), gone())).toThrow(TypeError);
         const one = createStrictWindow();
         const two = createStrictWindow();

         ipc.chat.connect(one, two);

         expect(posted(one)).toStrictEqual([[wire("chat"), "3:a", [{ name: "port1 of 2" }]]]);
         expect(posted(two)).toStrictEqual([[wire("chat"), "3:b", [{ name: "port2 of 2" }]]]);
      });
   });

   describe("a connection which fails while it is set up", () => {
      class FailingChannel {
         constructor() {
            throw new Error("no more ports");
         }
      }

      it("throws the error, and removes the listeners and the entries it registered", async () => {
         const { ipc } = await loadMainWithElectron(FailingChannel);
         const one = createWindow();
         const two = createWindow();

         expect(() => ipc.chat.connect(one, two)).toThrow("no more ports");

         expect([listenersOn(one), listenersOn(two)]).toStrictEqual([noListeners, noListeners]);
         // The windows are told that the connection is over, in case one of them got a port.
         expect(one.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:a"]]);
         expect(two.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:b"]]);
         // No later load pairs them.
         one.webContents.emit("did-finish-load");
         expect(posted(one)).toHaveLength(0);
      });
   });

   describe("a page which ends its connection", () => {
      it("listens for it once for the channel, however many connections there are", async () => {
         const { ipc, electron } = await loadMainWithElectron();

         ipc.chat.connect(createWindow(), createWindow());
         ipc.chat.connect(createWindow(), createWindow());

         const calls = electron.ipcMain.on.mock.calls.filter(
            ([channel]: [string]) => channel === disconnectWire("chat"),
         );
         expect(calls).toHaveLength(1);
      });

      it("ends the connection for both windows when the window which holds the end asks", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const hub = createWindow();
         const [first, second] = [createWindow(), createWindow()];
         ipc.chat.connect(hub, first);
         ipc.chat.connect(hub, second);

         disconnectListener(electron)({ sender: first.webContents }, "1:b");

         expect(hub.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:a"]]);
         expect(first.webContents.send.mock.calls).toStrictEqual([[closeWire("chat"), "1:b"]]);
         expect(second.webContents.send).not.toHaveBeenCalled();
         // The connection does not come back with a reload.
         first.webContents.emit("did-finish-load");
         expect(posted(first)).toHaveLength(1);
      });

      it("lets the hub end the connection of a peer as well", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const hub = createWindow();
         const peer = createWindow();
         ipc.chat.connect(hub, peer);

         disconnectListener(electron)({ sender: hub.webContents }, "1:a");

         expect(peer.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"), "1:b");
      });

      it("ignores a page which does not hold the end, an unknown key and a key which is no text", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const hub = createWindow();
         const peer = createWindow();
         const stranger = createWindow();
         ipc.chat.connect(hub, peer);
         const disconnect = disconnectListener(electron);

         disconnect({ sender: stranger.webContents }, "1:a");
         // A page may end only its own end, not the one of the other window.
         disconnect({ sender: peer.webContents }, "1:a");
         disconnect({ sender: hub.webContents }, "9:a");
         disconnect({ sender: hub.webContents }, 1);
         disconnect({ sender: hub.webContents }, undefined);
         disconnect({ sender: hub.webContents }, "__proto__");

         expect(hub.webContents.send).not.toHaveBeenCalled();
         expect(peer.webContents.send).not.toHaveBeenCalled();
      });

      it("forgets the ends of a connection once it is closed", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const hub = createWindow();
         const peer = createWindow();
         const connection = ipc.chat.connect(hub, peer);
         connection.close();

         disconnectListener(electron)({ sender: hub.webContents }, "1:a");

         expect(hub.webContents.send).toHaveBeenCalledOnce();
         expect(peer.webContents.send).toHaveBeenCalledOnce();
      });
   });
});

/** Loads the generated preload script, and returns what it exposes and listens to. */
async function loadPreload() {
   project = await runFixture("port-only");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   const chat = fake.exposed.ipc.chat;

   /**
    * Hands the page one end of a real channel under the key of a connection, and returns the other
    * end for the test. The same key again is a new port for that connection.
    */
   const connect = (key = "1:a") => {
      const channel = new MessageChannel();
      channels.push(channel);
      listener(wire("chat"))({ ports: [channel.port1] }, key);
      const peer = channel.port2;
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);
      return { channel, peer, received };
   };
   /** Tells the page that the main process ended the connection of a key. */
   const end = (key = "1:a") => listener(closeWire("chat"))({}, key);
   return { chat, connect, listener, end, ipcRenderer: fake.electron.ipcRenderer };
}

/** Lets the messages and the events of the real ports arrive. */
const settle = () => settlePorts(20);

describe("generated preload script of a port channel", () => {
   it("exposes the six methods and nothing else", async () => {
      const { chat } = await loadPreload();
      expect(Object.keys(chat).sort()).toStrictEqual([
         "on",
         "onClose",
         "onConnection",
         "onOverflow",
         "onReady",
         "send",
      ]);
   });

   // Regression for B9: `sendMessage` threw before the port arrived.
   it("queues the sends until the port arrives, and flushes them in order", async () => {
      const { chat, connect } = await loadPreload();

      chat.send("one");
      chat.send("two", 2);
      const { received } = connect();
      chat.send("three");
      await settle();

      expect(received).toStrictEqual([["one"], ["two", 2], ["three"]]);
   });

   it("flushes the queue before it tells the onReady subscribers, so that their sends come last", async () => {
      const { chat, connect } = await loadPreload();
      chat.onReady(() => chat.send("from onReady"));
      chat.send("queued");

      const { received } = connect();
      await settle();

      expect(received).toStrictEqual([["queued"], ["from onReady"]]);
   });

   it("flushes a queue only once", async () => {
      const { chat, connect } = await loadPreload();
      chat.send("once");

      connect();
      const second = connect();
      await settle();

      expect(second.received).toStrictEqual([]);
   });

   it("reports a message which cannot be cloned, and still sends the others", async () => {
      const { chat, connect } = await loadPreload();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      chat.send(() => undefined);
      chat.send("fine");

      const { received } = connect();
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(received).toStrictEqual([["fine"]]);
   });

   it("passes every message to every subscriber, with the arguments spread", async () => {
      const { chat, connect } = await loadPreload();
      const first = vi.fn();
      const second = vi.fn();
      chat.on(first);
      chat.on(second);
      const { peer } = connect();

      peer.postMessage(["hello", 1]);
      await settle();

      expect(first).toHaveBeenCalledExactlyOnceWith("hello", 1);
      expect(second).toHaveBeenCalledExactlyOnceWith("hello", 1);
   });

   it("lets a subscriber leave through its own disposer, even if the callback is the same", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      const disposeFirst = chat.on(callback);
      chat.on(callback);
      const { peer } = connect();

      peer.postMessage(["a"]);
      await settle();
      expect(callback).toHaveBeenCalledTimes(2);

      disposeFirst();
      disposeFirst();
      peer.postMessage(["b"]);
      await settle();
      expect(callback).toHaveBeenCalledTimes(3);
   });

   it("keeps the subscribers of an earlier port for the next one", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      chat.on(callback);

      connect();
      const { peer } = connect();
      peer.postMessage(["later"]);
      await settle();

      expect(callback).toHaveBeenCalledExactlyOnceWith("later");
   });

   it("lets one failing subscriber not keep the others from the message", async () => {
      const { chat, connect } = await loadPreload();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const after = vi.fn();
      chat.on(() => {
         throw new Error("boom");
      });
      chat.on(after);
      const { peer } = connect();

      peer.postMessage(["x"]);
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledWith("x");
   });

   it("ignores a message which is not an array of arguments", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      chat.on(callback);
      const { peer } = connect();

      peer.postMessage("not an array");
      await settle();

      expect(callback).not.toHaveBeenCalled();
   });

   it("ignores a message to the channel which carries no port", async () => {
      const { chat, listener } = await loadPreload();
      const onReady = vi.fn();
      chat.onReady(onReady);

      listener(wire("chat"))({ ports: [] }, "1:a");

      expect(onReady).not.toHaveBeenCalled();
   });

   describe("onReady", () => {
      it("runs for the port that arrives, and for every later one", async () => {
         const { chat, connect } = await loadPreload();
         const onReady = vi.fn();
         chat.onReady(onReady);

         connect();
         expect(onReady).toHaveBeenCalledOnce();
         connect();
         expect(onReady).toHaveBeenCalledTimes(2);
      });

      it("runs at once, and only for that subscriber, if a port is already there", async () => {
         const { chat, connect } = await loadPreload();
         const early = vi.fn();
         chat.onReady(early);
         connect();

         const late = vi.fn();
         chat.onReady(late);

         expect(late).toHaveBeenCalledOnce();
         expect(early).toHaveBeenCalledOnce();
      });

      it("does not run at once while there is no port", async () => {
         const { chat } = await loadPreload();
         const onReady = vi.fn();
         chat.onReady(onReady);
         expect(onReady).not.toHaveBeenCalled();
      });

      it("stops after its disposer is called, and reports a throwing subscriber", async () => {
         const { chat, connect } = await loadPreload();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const onReady = vi.fn();
         chat.onReady(() => {
            throw new Error("boom");
         });
         chat.onReady(onReady)();

         connect();

         expect(onReady).not.toHaveBeenCalled();
         expect(error).toHaveBeenCalledOnce();
      });
   });

   describe("a new port after a reload of the other page", () => {
      it("replaces the old port without a close event, and closes the old port", async () => {
         const { chat, connect } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const callback = vi.fn();
         chat.on(callback);

         const old = connect();
         const replacement = connect();
         await settle();

         expect(onClose).not.toHaveBeenCalled();
         // The peer of the old port sees it closed.
         old.peer.postMessage(["to the old"]);
         replacement.peer.postMessage(["to the new"]);
         await settle();
         expect(callback).toHaveBeenCalledExactlyOnceWith("to the new");

         chat.send("goes to the new");
         await settle();
         expect(replacement.received).toStrictEqual([["goes to the new"]]);
         expect(old.received).toStrictEqual([]);
      });

      it("closes the old port, which the other end can see", async () => {
         const { connect } = await loadPreload();
         const old = connect();
         const closed = new Promise<void>((resolve) =>
            old.peer.addEventListener("close", () => resolve()),
         );

         connect();

         await expect(closed).resolves.toBeUndefined();
      });
   });

   describe("onClose", () => {
      it("runs when the main process ends the connection, and the port is closed", async () => {
         const { chat, connect, end } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const { peer } = connect();
         const peerClosed = new Promise<void>((resolve) =>
            peer.addEventListener("close", () => resolve()),
         );

         end();

         expect(onClose).toHaveBeenCalledOnce();
         await expect(peerClosed).resolves.toBeUndefined();
      });

      it("runs when the other page closes its end of the port", async () => {
         const { chat, connect } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const { peer } = connect();

         peer.close();
         await settle();

         expect(onClose).toHaveBeenCalledOnce();
      });

      it("runs once if the end is signalled twice", async () => {
         const { chat, connect, end } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const { peer } = connect();

         end();
         peer.close();
         end();
         await settle();

         expect(onClose).toHaveBeenCalledOnce();
      });

      it("does not run for a connection which never had a port", async () => {
         const { chat, end } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);

         end();

         expect(onClose).not.toHaveBeenCalled();
      });

      it("does not run for the close of a port which a newer port replaced", async () => {
         const { chat, connect } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const old = connect();
         connect();

         old.peer.close();
         await settle();

         expect(onClose).not.toHaveBeenCalled();
      });

      it("stops after its disposer is called, and reports a throwing subscriber", async () => {
         const { chat, connect, end } = await loadPreload();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const onClose = vi.fn();
         chat.onClose(() => {
            throw new Error("boom");
         });
         chat.onClose(onClose)();
         connect();

         end();

         expect(onClose).not.toHaveBeenCalled();
         expect(error).toHaveBeenCalledOnce();
      });

      it("queues the sends after the end, and flushes them to the next port", async () => {
         const { chat, connect, end } = await loadPreload();
         connect();
         end();

         chat.send("after the end");
         const { received } = connect();
         await settle();

         expect(received).toStrictEqual([["after the end"]]);
      });
   });
});

describe("connections of a port channel in the generated preload script", () => {
   /** A hub page with `count` peers, each with the connection object that `onConnection` gave. */
   async function loadHub(count: number) {
      const loaded = await loadPreload();
      const connections: any[] = [];
      loaded.chat.onConnection((connection: unknown) => connections.push(connection));
      const peers = Array.from({ length: count }, (_, index) => loaded.connect(`${index + 1}:a`));
      return { ...loaded, connections, peers };
   }

   describe("onConnection", () => {
      it("runs for each peer with an object of its own, with the methods of the channel and close", async () => {
         const { connections } = await loadHub(3);

         expect(connections).toHaveLength(3);
         expect(new Set(connections).size).toBe(3);
         for (const connection of connections) {
            expect(Object.keys(connection).sort()).toStrictEqual([
               "close",
               "on",
               "onClose",
               "onOverflow",
               "onReady",
               "send",
            ]);
         }
      });

      it("keeps the messages of each peer apart", async () => {
         const { connections, peers, chat } = await loadHub(3);
         const heard = connections.map(() => vi.fn());
         for (const [index, connection] of connections.entries()) {
            connection.on(heard[index]);
         }
         const all = vi.fn();
         chat.on(all);

         peers[0].peer.postMessage(["from one"]);
         peers[2].peer.postMessage(["from three", 3]);
         await settle();

         expect(heard[0]).toHaveBeenCalledExactlyOnceWith("from one");
         expect(heard[1]).not.toHaveBeenCalled();
         expect(heard[2]).toHaveBeenCalledExactlyOnceWith("from three", 3);
         // The subscribers of the channel hear every peer.
         expect(all.mock.calls).toStrictEqual([["from one"], ["from three", 3]]);
      });

      it("sends to one peer through its connection and to all of them through the channel", async () => {
         const { connections, peers, chat } = await loadHub(3);

         connections[1].send("only two");
         chat.send("everyone");
         await settle();

         expect(peers.map(({ received }) => received)).toStrictEqual([
            [["everyone"]],
            [["only two"], ["everyone"]],
            [["everyone"]],
         ]);
      });

      it("gives the queue of the channel to the first connection only", async () => {
         const { chat, connect, connections } = await loadHub(0);
         chat.send("early");

         const first = connect("1:a");
         const second = connect("2:a");
         await settle();

         expect(first.received).toStrictEqual([["early"]]);
         expect(second.received).toStrictEqual([]);
         expect(connections).toHaveLength(2);
      });

      it("runs at once for the connections that are there, and then for the later ones", async () => {
         const { chat, connect } = await loadPreload();
         connect("1:a");
         connect("2:a");

         const seen = vi.fn();
         chat.onConnection(seen);
         expect(seen).toHaveBeenCalledTimes(2);

         connect("3:a");
         expect(seen).toHaveBeenCalledTimes(3);
      });

      it("stops after its disposer is called, and every subscriber has its own", async () => {
         const { chat, connect } = await loadPreload();
         const kept = vi.fn();
         const dropped = vi.fn();
         chat.onConnection(kept);
         const dispose = chat.onConnection(dropped);
         const same = chat.onConnection(kept);

         dispose();
         same();
         connect("1:a");

         expect(dropped).not.toHaveBeenCalled();
         expect(kept).toHaveBeenCalledOnce();
      });

      it("reports a throwing subscriber and still tells the others", async () => {
         const { chat, connect } = await loadPreload();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const after = vi.fn();
         chat.onConnection(() => {
            throw new Error("boom");
         });
         chat.onConnection(after);

         connect("1:a");

         expect(error).toHaveBeenCalledOnce();
         expect(after).toHaveBeenCalledOnce();
      });

      it("lets the callback use the connection at once: the port is there", async () => {
         const { chat, connect } = await loadPreload();
         chat.onConnection((connection: any) => connection.send("welcome"));

         const { received } = connect("1:a");
         await settle();

         expect(received).toStrictEqual([["welcome"]]);
      });
   });

   describe("a connection", () => {
      it("is the same object after the port of its key arrives again", async () => {
         const { connections, connect, chat } = await loadHub(1);
         const onReady = vi.fn();
         connections[0].onReady(onReady);
         const onClose = vi.fn();
         connections[0].onClose(onClose);
         const seen = vi.fn();
         chat.onConnection(seen);
         seen.mockClear();

         const replacement = connect("1:a");
         connections[0].send("to the new");
         await settle();

         expect(connections).toHaveLength(1);
         expect(seen).not.toHaveBeenCalled();
         expect(onReady).toHaveBeenCalledTimes(2);
         expect(onClose).not.toHaveBeenCalled();
         expect(replacement.received).toStrictEqual([["to the new"]]);
      });

      it("queues its sends while its peer reloads, and flushes them to the new port", async () => {
         const { connections, peers, connect } = await loadHub(2);

         peers[0].peer.close();
         await settle();
         connections[0].send("while away");
         connections[1].send("not away");
         const back = connect("1:a");
         await settle();

         expect(back.received).toStrictEqual([["while away"]]);
         expect(peers[1].received).toStrictEqual([["not away"]]);
      });

      it("runs onReady at once if its port is there, not otherwise", async () => {
         const { connections, peers } = await loadHub(1);
         const now = vi.fn();
         connections[0].onReady(now);
         expect(now).toHaveBeenCalledOnce();

         peers[0].peer.close();
         await settle();
         const later = vi.fn();
         connections[0].onReady(later);
         expect(later).not.toHaveBeenCalled();
      });

      it("runs onClose when its peer closes the port, for this connection and for the channel", async () => {
         const { chat, connections, peers } = await loadHub(3);
         const closed = connections.map(() => vi.fn());
         for (const [index, connection] of connections.entries()) {
            connection.onClose(closed[index]);
         }
         const any = vi.fn();
         chat.onClose(any);

         peers[1].peer.close();
         await settle();

         expect(closed.map((callback) => callback.mock.calls.length)).toStrictEqual([0, 1, 0]);
         expect(any).toHaveBeenCalledOnce();
         // The others still work.
         connections[0].send("still here");
         await settle();
         expect(peers[0].received).toStrictEqual([["still here"]]);
      });

      it("ends only the connection of the key that the main process closes", async () => {
         const { chat, connections, peers, end } = await loadHub(3);
         const closed = connections.map(() => vi.fn());
         for (const [index, connection] of connections.entries()) {
            connection.onClose(closed[index]);
         }
         const peerClosed = new Promise<void>((resolve) =>
            peers[1].peer.addEventListener("close", () => resolve()),
         );

         end("2:a");

         expect(closed.map((callback) => callback.mock.calls.length)).toStrictEqual([0, 1, 0]);
         await expect(peerClosed).resolves.toBeUndefined();
         // A send of the channel reaches the two that are left.
         chat.send("rest");
         await settle();
         expect(peers.map(({ received }) => received)).toStrictEqual([[["rest"]], [], [["rest"]]]);
      });

      it("ignores the end of a key it does not know, and one that is no text", async () => {
         const { connections, end, listener } = await loadHub(1);
         const onClose = vi.fn();
         connections[0].onClose(onClose);

         end("9:a");
         listener(closeWire("chat"))({}, undefined);
         listener(closeWire("chat"))({}, 1);

         expect(onClose).not.toHaveBeenCalled();
      });

      it("tells the main process when it closes, and ends at once: onClose, the port, no more sends", async () => {
         const { connections, peers, ipcRenderer, chat, end } = await loadHub(2);
         const onClose = vi.fn();
         connections[0].onClose(onClose);
         const channelClose = vi.fn();
         chat.onClose(channelClose);
         const peerClosed = new Promise<void>((resolve) =>
            peers[0].peer.addEventListener("close", () => resolve()),
         );

         connections[0].close();
         connections[0].close();
         connections[0].send("too late");
         await settle();

         expect(ipcRenderer.send).toHaveBeenCalledExactlyOnceWith(disconnectWire("chat"), "1:a");
         expect(onClose).toHaveBeenCalledOnce();
         expect(channelClose).toHaveBeenCalledOnce();
         await expect(peerClosed).resolves.toBeUndefined();
         expect(peers[0].received).toStrictEqual([]);
         // The main process answers with the close of the key, which changes nothing.
         end("1:a");
         expect(onClose).toHaveBeenCalledOnce();
      });

      it("does not tell the main process when the main process ended it", async () => {
         const { connections, ipcRenderer, end } = await loadHub(1);

         end("1:a");
         connections[0].close();

         expect(ipcRenderer.send).not.toHaveBeenCalled();
      });

      it("makes the channel queue again once its last connection has ended", async () => {
         const { chat, connect, connections } = await loadHub(1);

         connections[0].close();
         chat.send("after the last");
         const next = connect("2:a");
         await settle();

         expect(next.received).toStrictEqual([["after the last"]]);
      });
   });

   describe("onReady and onClose of the channel", () => {
      it("runs onReady for every connection that becomes ready", async () => {
         const { chat, connect } = await loadPreload();
         const onReady = vi.fn();
         chat.onReady(onReady);

         connect("1:a");
         connect("2:a");
         connect("1:a");

         expect(onReady).toHaveBeenCalledTimes(3);
      });

      it("runs onReady at once while any connection has a port", async () => {
         const { chat, connect } = await loadPreload();
         connect("1:a");

         const onReady = vi.fn();
         chat.onReady(onReady);

         expect(onReady).toHaveBeenCalledOnce();
      });
   });
});
