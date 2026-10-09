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
   connectWaiting,
   createContents,
   flushed,
   lastPort,
   loadBoundedProject,
   loadMain,
   messages,
   range,
   sendMany,
} from "@testutils/e2e/port-queue-utils.js";
import { finishLoading } from "@testutils/e2e/runtime-utils.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(loadBoundedProject);

beforeEach(() => {
   warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
   error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
   vi.restoreAllMocks();
});

describe("the send queue of a mainPort connection in the main process", () => {
   describe("before the page has loaded", () => {
      it("keeps the newest maxQueue messages, and flushes them in order when the port is there", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 5);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(3, 5));
      });

      it("drops the oldest message by default, and warns once", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 5);

         expect(warn).toHaveBeenCalledOnce();
         expect(error).not.toHaveBeenCalled();
      });

      it("queues nothing for a maxQueue of 0", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 4);
         finishLoading(contents);

         expect(flushed()).toStrictEqual([]);
      });

      it("never drops for a maxQueue of Infinity, and never warns", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "frames");

         sendMany(connection.send, 3000);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(1, 3000));
         expect(warn).not.toHaveBeenCalled();
      });

      it("holds 1000 messages when the channel sets no maxQueue", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "defaulted");

         sendMany(connection.send, 1001);
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 1001));
      });

      it("keeps a queue per connection", () => {
         const main = loadMain();
         const one = connectWaiting(main, "logTail");
         const two = connectWaiting(main, "logTail");

         sendMany(one.connection.send, 4, "one");
         sendMany(two.connection.send, 2, "two");
         finishLoading(one.contents);
         const first = flushed();
         finishLoading(two.contents);

         expect(first).toStrictEqual(range(2, 4, "one"));
         expect(flushed()).toStrictEqual(range(1, 2, "two"));
      });
   });

   describe("after the port has closed while the contents are alive", () => {
      it("queues again, and takes new messages once the queue has drained", () => {
         const main = loadMain();
         const contents = createContents();
         const connection = main.ipc.logTail.connect(contents);
         lastPort().emit("close");
         sendMany(connection.send, 4);
         const closed = lastPort();

         finishLoading(contents);
         lastPort().emit("close");
         sendMany(connection.send, 3, "later");
         finishLoading(contents);

         expect(closed.postMessage).not.toHaveBeenCalled();
         expect(messages(channelsMade[1].port1.postMessage)).toStrictEqual(range(2, 4));
         expect(flushed()).toStrictEqual(range(1, 3, "later"));
      });

      it("drops what is queued when the connection is closed", () => {
         const main = loadMain();
         const { contents, connection } = connectWaiting(main, "logTail");
         sendMany(connection.send, 2);

         connection.close();
         sendMany(connection.send, 2, "after");
         finishLoading(contents);

         expect(channelsMade).toHaveLength(0);
      });
   });
});
