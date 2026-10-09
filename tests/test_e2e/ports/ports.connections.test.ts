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

import { cleanupPortConnect, loadHub, loadPreload } from "@testutils/e2e/port-connect-utils.js";
import { closeWire, disconnectWire, settle } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupPortConnect();
});

describe("connections of a port channel in the generated preload script", () => {
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
