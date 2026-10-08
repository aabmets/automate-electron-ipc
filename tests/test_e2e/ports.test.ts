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
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const closeWire = (name: string) => `autoipc:${name}:close`;

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
   });
   const win = Object.assign(new EventEmitter(), {
      destroyed: state.destroyed ?? false,
      webContents: contents,
      isDestroyed: () => win.destroyed,
   });
   return win;
}
type FakeWindow = ReturnType<typeof createWindow>;

/** Destroys a window the way Electron does: it emits `closed` once it can no longer be used. */
function destroy(win: FakeWindow) {
   win.destroyed = true;
   win.emit("closed");
}

/** The wire names and ports of the messages that were posted to a window, in order. */
const posted = (win: FakeWindow) => win.webContents.postMessage.mock.calls;

async function loadMain() {
   project = await runFixture("port-only");
   let created = 0;
   class FakeChannel {
      id = ++created;
      port1 = { name: `port1 of ${this.id}` };
      port2 = { name: `port2 of ${this.id}` };
   }
   const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannel };
   return loadGenerated(project.generated["main.ts"], { electron }).ipc;
}

describe("ipc.<name>.connect", () => {
   it("posts the ends at once when both windows have loaded, port1 to the first window", async () => {
      const ipc = await loadMain();
      const one = createWindow();
      const two = createWindow();

      ipc.chat.connect(one, two);

      expect(posted(one)).toStrictEqual([[wire("chat"), null, [{ name: "port1 of 1" }]]]);
      expect(posted(two)).toStrictEqual([[wire("chat"), null, [{ name: "port2 of 1" }]]]);
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

      late.webContents.loading = false;
      late.webContents.emit("did-finish-load");
      expect(posted(one)).toStrictEqual([[wire("chat"), null, [{ name: "port1 of 1" }]]]);
      expect(posted(late)).toStrictEqual([[wire("chat"), null, [{ name: "port2 of 1" }]]]);
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

      two.webContents.loading = true;
      one.webContents.emit("did-finish-load");

      expect(posted(one)).toHaveLength(1);
      expect(posted(two)).toHaveLength(1);
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

      expect(one.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"));
      expect(two.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"));
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
      late.webContents.loading = false;
      late.webContents.emit("did-finish-load");

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
      expect(one.webContents.send).toHaveBeenCalledExactlyOnceWith(closeWire("chat"));
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
      expect(win.webContents.send).toHaveBeenCalledOnce();
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

   /** Hands the page one end of a real channel, and returns the other end for the test. */
   const connect = () => {
      const channel = new MessageChannel();
      channels.push(channel);
      listener(wire("chat"))({ ports: [channel.port1] });
      const peer = channel.port2;
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);
      return { channel, peer, received };
   };
   return { chat, connect, listener };
}

/** Lets the messages and the events of the real ports arrive. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("generated preload script of a port channel", () => {
   it("exposes the four methods and nothing else", async () => {
      const { chat } = await loadPreload();
      expect(Object.keys(chat).sort()).toStrictEqual(["on", "onClose", "onReady", "send"]);
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

      listener(wire("chat"))({ ports: [] });

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
         const { chat, connect, listener } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const { peer } = connect();
         const peerClosed = new Promise<void>((resolve) =>
            peer.addEventListener("close", () => resolve()),
         );

         listener(closeWire("chat"))();

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
         const { chat, connect, listener } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);
         const { peer } = connect();

         listener(closeWire("chat"))();
         peer.close();
         listener(closeWire("chat"))();
         await settle();

         expect(onClose).toHaveBeenCalledOnce();
      });

      it("does not run for a connection which never had a port", async () => {
         const { chat, listener } = await loadPreload();
         const onClose = vi.fn();
         chat.onClose(onClose);

         listener(closeWire("chat"))();

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
         const { chat, connect, listener } = await loadPreload();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const onClose = vi.fn();
         chat.onClose(() => {
            throw new Error("boom");
         });
         chat.onClose(onClose)();
         connect();

         listener(closeWire("chat"))();

         expect(onClose).not.toHaveBeenCalled();
         expect(error).toHaveBeenCalledOnce();
      });

      it("queues the sends after the end, and flushes them to the next port", async () => {
         const { chat, connect, listener } = await loadPreload();
         connect();
         listener(closeWire("chat"))();

         chat.send("after the end");
         const { received } = connect();
         await settle();

         expect(received).toStrictEqual([["after the end"]]);
      });
   });
});
