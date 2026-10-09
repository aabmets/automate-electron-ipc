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
   loadHub,
   loadPreload,
   settle,
} from "@testutils/e2e/port-connect-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupPortConnect();
});

describe("connections of a port channel in the generated preload script", () => {
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
});
