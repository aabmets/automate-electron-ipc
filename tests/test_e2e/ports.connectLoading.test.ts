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
   listenersOn,
   loadMain,
   noListeners,
   posted,
} from "@testutils/port-connect-utils.js";
import {
   abortNavigation,
   commitNavigation,
   failLoading,
   finishLoading,
   startLoading,
   stopCommittedLoad,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupPortConnect();
});

describe("ipc.<name>.connect", () => {
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

      it("pairs a window whose load is stopped after its navigation committed (ERR_ABORTED)", async () => {
         const ipc = await loadMain();
         const one = createWindow();
         const two = createWindow();
         startLoading(two.webContents);
         ipc.chat.connect(one, two);

         stopCommittedLoad(two.webContents);

         expect(posted(one)).toHaveLength(1);
         expect(posted(two)).toHaveLength(1);
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
});
