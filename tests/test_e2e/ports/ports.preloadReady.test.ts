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

import { cleanupPortConnect, loadPreload, settle } from "@testutils/e2e/port-connect-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupPortConnect();
});

describe("generated preload script of a port channel", () => {
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
