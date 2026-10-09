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
   closeWire,
   createWindow,
   destroy,
   loadMain,
   posted,
   wire,
} from "@testutils/e2e/port-connect-utils.js";
import { commitNavigation, finishLoading, startLoading } from "@testutils/e2e/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupPortConnect();
});

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
});
