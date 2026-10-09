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

import { type E2EProject } from "@testutils/e2e-utils.js";
import {
   loadBoundedProject,
   loadPage,
   posted,
   range,
   sendMany,
} from "@testutils/port-queue-utils.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
   project = await loadBoundedProject();
});

afterAll(async () => {
   await project.cleanup();
});

beforeEach(() => {
   warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
   vi.restoreAllMocks();
});

describe("the send queue of a port channel in the preload script", () => {
   describe("the registration of the overflow callback", () => {
      /** A lost connection of `logTail`, with the callbacks that a test registers. */
      function loadConnection() {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail").emitClose();
         return { ...loaded, connection: connections[0] };
      }

      it("uses the callback of the connection over the one of the channel", () => {
         const { ipc, connection } = loadConnection();
         const ofChannel = vi.fn(() => "dropOldest");
         const ofConnection = vi.fn(() => "dropNewest");
         ipc.logTail.onOverflow(ofChannel);
         connection.onOverflow(ofConnection);

         sendMany(connection.send, 4);

         expect(ofChannel).not.toHaveBeenCalled();
         expect(ofConnection).toHaveBeenCalledOnce();
      });

      it("goes back to the callback of the channel when the override is disposed", () => {
         const { ipc, connection } = loadConnection();
         const ofChannel = vi.fn(() => "dropOldest");
         const ofConnection = vi.fn(() => "dropNewest");
         ipc.logTail.onOverflow(ofChannel);
         const dispose = connection.onOverflow(ofConnection);

         dispose();
         sendMany(connection.send, 4);

         expect(ofChannel).toHaveBeenCalledOnce();
         expect(ofConnection).not.toHaveBeenCalled();
      });

      it("goes back to the default when the callback of the channel is disposed", () => {
         const { ipc, connection, pair } = loadConnection();
         const ofChannel = vi.fn(() => "dropNewest");
         const dispose = ipc.logTail.onOverflow(ofChannel);

         dispose();
         sendMany(connection.send, 4);

         expect(ofChannel).not.toHaveBeenCalled();
         expect(posted(pair("logTail"))).toStrictEqual(range(2, 4));
      });

      it("replaces the previous callback, whose disposer then removes nothing", () => {
         const { ipc } = loadPage();
         const first = vi.fn(() => "dropOldest");
         const second = vi.fn(() => "dropOldest");
         const disposeFirst = ipc.chat.onOverflow(first);
         ipc.chat.onOverflow(second);

         disposeFirst();
         sendMany(ipc.chat.send, 3);

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledOnce();
      });

      it("keeps the callback of a connection apart from the ones of the other connections", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail", "1:main").emitClose();
         loaded.pair("logTail", "2:main").emitClose();
         const callback = vi.fn(() => "dropOldest");
         connections[0].onOverflow(callback);

         sendMany(connections[1].send, 4);

         expect(callback).not.toHaveBeenCalled();
      });

      it("uses only the callback of the channel for the queue that waits for a connection", () => {
         const { ipc } = loadPage();
         const ofChannel = vi.fn(() => "dropOldest");
         ipc.logTail.onOverflow(ofChannel);

         sendMany(ipc.logTail.send, 4);

         expect(ofChannel).toHaveBeenCalledOnce();
      });

      it("applies a callback that is set later to the queues that exist", () => {
         const { ipc, connection } = loadConnection();
         sendMany(connection.send, 4);
         const callback = vi.fn(() => "dropOldest");

         ipc.logTail.onOverflow(callback);
         connection.send("m5");

         expect(callback).toHaveBeenCalledOnce();
      });
   });

   describe("the warnings", () => {
      /** Sends to `nobody`, which has a maxQueue of 0, so that every message is dropped. */
      function dropMany(count: number, send: (...args: unknown[]) => void) {
         sendMany(send, count);
      }

      it("warns at the first drop, not again until the 100th, and then at every 100th", () => {
         const { ipc } = loadPage();

         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(1);
         dropMany(98, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(1);
         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(2);
         dropMany(99, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(2);
         dropMany(1, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(3);
         dropMany(100, ipc.nobody.send);
         expect(warn).toHaveBeenCalledTimes(4);
      });

      it("names the channel and the limit, and gives the counts", () => {
         const { ipc } = loadPage();

         dropMany(100, ipc.nobody.send);

         const [first] = warn.mock.calls[0];
         const [second] = warn.mock.calls[1];
         expect(first).toContain("'nobody'");
         expect(first).toContain("maxQueue 0");
         expect(first).toContain("messages are being dropped");
         expect(first).toContain("Dropped so far: 1.");
         expect(first).toContain("Warnings so far: 1.");
         expect(second).toContain("Dropped so far: 100.");
         expect(second).toContain("Warnings so far: 2.");
      });

      it("hands the counts to the callback", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.nobody.onOverflow(callback);

         dropMany(101, ipc.nobody.send);

         const infos = callback.mock.calls.map(([, info]) => info);
         expect(infos[0]).toStrictEqual({ channel: "nobody", max: 0, dropped: 0, warnings: 0 });
         expect(infos[1]).toStrictEqual({ channel: "nobody", max: 0, dropped: 1, warnings: 1 });
         expect(infos[99]).toStrictEqual({ channel: "nobody", max: 0, dropped: 99, warnings: 1 });
         expect(infos[100]).toStrictEqual({ channel: "nobody", max: 0, dropped: 100, warnings: 2 });
      });

      it("does not reset the counts when a queue drains and overflows again", () => {
         const { ipc, pair, end } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);
         sendMany(ipc.chat.send, 3);
         pair("chat");
         end("chat");

         sendMany(ipc.chat.send, 3, "again");

         expect(callback.mock.calls[1][1]).toStrictEqual({
            channel: "chat",
            max: 2,
            dropped: 1,
            warnings: 1,
         });
         // The second drop is not the first, and not the 100th.
         expect(warn).toHaveBeenCalledOnce();
      });

      it("counts per queue, so every connection warns for its own first drop", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.nobody.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("nobody", "1:main").emitClose();
         loaded.pair("nobody", "2:main").emitClose();

         connections[0].send("a");
         connections[1].send("b");

         expect(warn).toHaveBeenCalledTimes(2);
      });
   });
});
