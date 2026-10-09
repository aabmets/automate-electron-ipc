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
   connectWaiting,
   flushed,
   loadBoundedProject,
   loadMain,
   range,
   sendMany,
} from "@testutils/e2e/port-queue-utils.js";
import { finishLoading } from "@testutils/e2e/runtime-utils.js";
import { type E2EProject } from "@testutils/e2e-utils.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
   project = await loadBoundedProject();
});

afterAll(async () => {
   await project.cleanup();
});

beforeEach(() => {
   error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
   vi.restoreAllMocks();
});

describe("the send queue of a mainPort connection in the main process", () => {
   describe("the overflow callback", () => {
      /** A connection whose queue holds m1, m2 and m3, with the callback of the test. */
      function loadFull(callback: ((...args: any[]) => unknown) | undefined, global = true) {
         const main = loadMain();
         const waiting = connectWaiting(main, "logTail");
         if (callback && global) {
            main.configurePorts({ onOverflow: callback });
         } else if (callback) {
            waiting.connection.onOverflow(callback);
         }
         sendMany(waiting.connection.send, 3);
         return { main, ...waiting };
      }

      it("gets the queue, the new message and the info", () => {
         const callback = vi.fn((queue: unknown[][]) => queue);
         const { connection } = loadFull(callback);

         connection.send("m4", 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0]).toStrictEqual([
            range(1, 3),
            ["m4", 2],
            { channel: "logTail", max: 3, dropped: 0, warnings: 0 },
         ]);
      });

      it("keeps what it returns: dropping the oldest", () => {
         const { contents, connection } = loadFull((queue, message) => [
            ...queue.slice(1),
            message,
         ]);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("keeps what it returns: dropping the newest", () => {
         const { contents, connection } = loadFull((queue) => queue);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(1, 3));
      });

      it("keeps what it returns: clearing", () => {
         const { contents, connection } = loadFull(() => []);

         connection.send("m4");
         connection.send("m5");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(5, 5));
      });

      it("keeps what it returns: coalescing the waiting messages", () => {
         const { contents, connection } = loadFull((queue, message) => [
            [`${queue.map(([text]) => text).join("+")}+${message[0]}`],
         ]);

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual([["m1+m2+m3+m4"]]);
      });

      it("drops the oldest of a list that is longer than maxQueue, and counts them", () => {
         const callback = vi.fn((queue: unknown[][], message: unknown[], _info: any) => [
            ...queue,
            message,
            ["extra"],
         ]);
         const { contents, connection } = loadFull(callback);

         connection.send("m4");
         connection.send("m5");
         finishLoading(contents);

         // m4 and extra were kept with m3. m5 and the extra after it replaced m3 and m4.
         expect(flushed()).toStrictEqual([["extra"], ["m5"], ["extra"]]);
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 2]);
      });

      it("counts the waiting messages and the new one that it left out", () => {
         const callback = vi.fn((..._args: any[]) => []);
         const { connection } = loadFull(callback);

         connection.send("m4");
         sendMany(connection.send, 4, "n");

         // The first call left out m1 to m4. The queue then filled up again, and overflowed.
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 4]);
      });

      it("drops the oldest and logs when it does not return an array", () => {
         const { contents, connection } = loadFull(() => "dropOldest");

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(String(error.mock.calls[0][0])).toMatch(/'logTail'.*must return an array/);
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("drops the oldest and logs when the array holds something that is not a message", () => {
         const { contents, connection } = loadFull((queue) => [...queue, "m4"]);

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("drops the oldest and logs when it throws", () => {
         const failure = new Error("boom");
         const { contents, connection } = loadFull(() => {
            throw failure;
         });

         connection.send("m4");
         finishLoading(contents);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("hands over a copy, so that a callback which fails halfway leaves the queue as it was", () => {
         const { contents, connection } = loadFull((queue) => {
            queue.length = 0;
            throw new Error("boom");
         });

         connection.send("m4");
         finishLoading(contents);

         expect(flushed()).toStrictEqual(range(2, 4));
      });

      it("does not keep a list that the callback returns, which it may change later", () => {
         const kept: unknown[][] = [["k1"]];
         const { contents, connection } = loadFull(() => kept);

         connection.send("m4");
         kept.push(["k2"]);
         finishLoading(contents);

         expect(flushed()).toStrictEqual([["k1"]]);
      });

      it("is called for every message when maxQueue is 0, with an empty queue", () => {
         const main = loadMain();
         const callback = vi.fn((queue: unknown[][], message: unknown[]) => [...queue, message]);
         main.configurePorts({ onOverflow: callback });
         const { contents, connection } = connectWaiting(main, "meters");

         connection.send(1);
         connection.send(2);
         finishLoading(contents);

         expect(callback.mock.calls.map(([queue]) => queue)).toStrictEqual([[], []]);
         expect(callback.mock.calls.map(([, , info]) => info.dropped)).toStrictEqual([0, 1]);
         // What it wanted to keep does not fit.
         expect(flushed()).toStrictEqual([]);
      });

      it("is not called while the queue has room", () => {
         const main = loadMain();
         const callback = vi.fn();
         main.configurePorts({ onOverflow: callback });
         const { connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 3);

         expect(callback).not.toHaveBeenCalled();
      });
   });
});
