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
   loadBoundedProject,
   loadPage,
   posted,
   range,
   sendMany,
} from "@testutils/e2e/port-queue-utils.js";
import { type E2EProject } from "@testutils/e2e-utils.js";
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
   describe("the queue of the channel, while there is no connection", () => {
      it("keeps the newest maxQueue messages, and flushes them in order to the first connection", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.chat.send, 5);
         const port = pair("chat");

         expect(posted(port)).toStrictEqual(range(4, 5));
      });

      it("drops the oldest message by default, and warns", () => {
         const { ipc } = loadPage();

         sendMany(ipc.chat.send, 3);

         expect(warn).toHaveBeenCalledOnce();
      });

      it("queues nothing for a maxQueue of 0", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.nobody.send, 4);
         const port = pair("nobody");

         expect(posted(port)).toStrictEqual([]);
      });

      it("never drops for a maxQueue of Infinity, and never warns", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.frames.send, 3000);
         const port = pair("frames");

         expect(posted(port)).toStrictEqual(range(1, 3000));
         expect(warn).not.toHaveBeenCalled();
      });

      it("holds 1000 messages when the channel sets no maxQueue", () => {
         const { ipc, pair } = loadPage();

         sendMany(ipc.plain.send, 1001);
         const port = pair("plain");

         expect(posted(port)).toStrictEqual(range(2, 1001));
         expect(warn).toHaveBeenCalledOnce();
      });

      it("takes new messages again once the first connection has drained it", () => {
         const { ipc, pair, end } = loadPage();
         sendMany(ipc.chat.send, 3);
         pair("chat");
         end("chat");

         sendMany(ipc.chat.send, 2, "again");
         const port = pair("chat", "2:main");

         expect(posted(port)).toStrictEqual(range(1, 2, "again"));
      });
   });

   describe("the queue of a connection, while its port is closed", () => {
      /** A connection of `logTail`, which holds three messages, and the port it has lost. */
      function loadLostConnection() {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         const port = loaded.pair("logTail");
         port.emitClose();
         return { ...loaded, connection: connections[0], port };
      }

      it("keeps the newest maxQueue messages, and flushes them in order to the next port", () => {
         const { connection, pair } = loadLostConnection();

         sendMany(connection.send, 5);
         const next = pair("logTail");

         expect(posted(next)).toStrictEqual(range(3, 5));
      });

      it("takes new messages again after a flush", () => {
         const { connection, pair } = loadLostConnection();
         sendMany(connection.send, 4);
         const first = pair("logTail");
         first.emitClose();

         sendMany(connection.send, 3, "later");
         const second = pair("logTail");

         expect(posted(first)).toStrictEqual(range(2, 4));
         expect(posted(second)).toStrictEqual(range(1, 3, "later"));
      });

      it("holds nothing for a maxQueue of 0", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.nobody.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("nobody").emitClose();

         sendMany(connections[0].send, 3);
         const next = loaded.pair("nobody");

         expect(posted(next)).toStrictEqual([]);
      });

      it("keeps a queue per connection", () => {
         const loaded = loadPage();
         const connections: any[] = [];
         loaded.ipc.logTail.onConnection((connection: unknown) => connections.push(connection));
         loaded.pair("logTail", "1:main").emitClose();
         loaded.pair("logTail", "2:main").emitClose();

         sendMany(connections[0].send, 4, "one");
         sendMany(connections[1].send, 2, "two");

         expect(posted(loaded.pair("logTail", "1:main"))).toStrictEqual(range(2, 4, "one"));
         expect(posted(loaded.pair("logTail", "2:main"))).toStrictEqual(range(1, 2, "two"));
      });

      it("drops what is queued when the connection ends", () => {
         const { connection, end, pair } = loadLostConnection();
         sendMany(connection.send, 2);

         end("logTail");
         sendMany(connection.send, 2, "after");
         const port = pair("logTail");

         expect(posted(port)).toStrictEqual([]);
      });
   });
});
