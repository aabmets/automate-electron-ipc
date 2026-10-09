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
   channelsMade,
   cleanupMainPorts,
   createContents,
   destroy,
   lastPort,
   loadMain,
} from "@testutils/main-port-utils.js";
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
   await cleanupMainPorts();
});

describe("ipc.<name>.connect of a mainPort channel", () => {
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

      it("pairs the document that committed when its load is stopped (ERR_ABORTED after a commit)", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true, url: "" });
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         connection.send("queued");

         startLoading(contents);
         stopCommittedLoad(contents);

         expect(onReady).toHaveBeenCalledOnce();
         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("pairs a reloaded page whose load is stopped after a commit, and a later load pairs again", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         onReady.mockClear();

         startLoading(contents);
         stopCommittedLoad(contents);
         expect(onReady).toHaveBeenCalledOnce();

         startLoading(contents);
         finishLoading(contents);
         expect(onReady).toHaveBeenCalledTimes(2);
      });

      it("still does not pair a load that fails with an error after a commit", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         connection.onReady(onReady);
         onReady.mockClear();

         startLoading(contents);
         commitNavigation(contents);
         failLoading(contents);

         expect(onReady).not.toHaveBeenCalled();
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

      // Node warns about more than ten listeners of one event (T87).
      it("adds one listener of each event to the contents, however many connections they have", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connections = Array.from({ length: 12 }, () => ipc.logTail.connect(contents));

         for (const event of [
            "did-navigate",
            "did-fail-load",
            "did-finish-load",
            "did-stop-loading",
            "destroyed",
         ]) {
            expect(contents.listenerCount(event)).toBe(1);
         }
         for (const connection of connections.slice(0, 11)) {
            connection.close();
         }
         expect(contents.listenerCount("destroyed")).toBe(1);

         // The connection that is left still ends with the contents.
         const last = connections[11];
         const closed = vi.fn();
         last.onClose(closed);
         destroy(contents);
         expect(closed).toHaveBeenCalledOnce();
         expect(contents.listenerCount("destroyed")).toBe(0);
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
});
