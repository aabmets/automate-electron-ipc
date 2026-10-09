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

import {
   cleanupPortConnect,
   createWindow,
   destroy,
   type FakeWindow,
   listenersOn,
   loadMain,
   loadMainWithElectron,
   noListeners,
   posted,
} from "@testutils/e2e/port-connect-utils.js";
import { createFakeElectron } from "@testutils/e2e/runtime-utils.js";
import { closeWire, disconnectWire, wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupPortConnect();
});

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

/** The listener that the main process registered for the page which ends a connection. */
function disconnectListener(electron: ReturnType<typeof createFakeElectron>) {
   const call = electron.ipcMain.on.mock.calls.find(
      ([channel]: [string]) => channel === disconnectWire("chat"),
   );
   return call?.[1] as (event: { sender: unknown }, key: unknown) => void;
}

describe("ipc.<name>.connect", () => {
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
