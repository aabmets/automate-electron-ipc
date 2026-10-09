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

describe("the send queue of a port channel in the preload script", () => {
   describe("the overflow callback", () => {
      it("gets the new message and the info, and not the queue", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 3);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0]).toStrictEqual([
            ["m3"],
            { channel: "chat", max: 2, dropped: 0, warnings: 0 },
         ]);
      });

      it("hands over the whole argument list of the message", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.logTail.onOverflow(callback);

         for (const line of ["a", "b", "c"]) {
            ipc.logTail.send(line, 1);
         }
         ipc.logTail.send("d", 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback.mock.calls[0][0]).toStrictEqual(["d", 2]);
      });

      it("drops the oldest message for 'dropOldest'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "dropOldest");

         sendMany(ipc.chat.send, 3);

         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it("drops the new message for 'dropNewest'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "dropNewest");

         sendMany(ipc.chat.send, 4);

         expect(posted(pair("chat"))).toStrictEqual(range(1, 2));
      });

      it("drops everything that is queued and queues the new message for 'clear'", () => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => "clear");

         sendMany(ipc.chat.send, 3);
         ipc.chat.send("m4");

         expect(posted(pair("chat"))).toStrictEqual(range(3, 4));
      });

      it("counts what 'clear' dropped", () => {
         const { ipc } = loadPage();
         const callback = vi.fn((..._args: any[]) => "clear");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 3);
         ipc.chat.send("m4");
         ipc.chat.send("m5");

         // The first overflow cleared the two that were queued. m4 fitted, and m5 overflowed.
         expect(callback.mock.calls.map(([, info]) => info.dropped)).toStrictEqual([0, 2]);
      });

      it("falls back to dropping the oldest, and logs, when the callback throws", () => {
         const { ipc, pair } = loadPage();
         const failure = new Error("boom");
         ipc.chat.onOverflow(() => {
            throw failure;
         });

         sendMany(ipc.chat.send, 3);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it.each([
         ["undefined", undefined],
         ["a string that is not an action", "dropEverything"],
         ["an object", { action: "clear" }],
         ["a promise", Promise.resolve("clear")],
      ])("logs and drops the oldest when the callback returns %s", (_, value) => {
         const { ipc, pair } = loadPage();
         ipc.chat.onOverflow(() => value);

         sendMany(ipc.chat.send, 3);

         expect(error).toHaveBeenCalledOnce();
         expect(String(error.mock.calls[0][0])).toMatch(
            /'chat'.*'dropOldest', 'dropNewest' or 'clear'/,
         );
         expect(posted(pair("chat"))).toStrictEqual(range(2, 3));
      });

      it("is called for every message when maxQueue is 0, and nothing is queued whatever it answers", () => {
         const { ipc, pair } = loadPage();
         const callback = vi.fn(() => "clear");
         ipc.nobody.onOverflow(callback);

         sendMany(ipc.nobody.send, 3);

         expect(callback.mock.calls.map(([, info]) => info.dropped)).toStrictEqual([0, 1, 2]);
         expect(posted(pair("nobody"))).toStrictEqual([]);
      });

      it("counts a message that cannot be queued once, whichever action", () => {
         for (const action of ["dropOldest", "dropNewest", "clear"]) {
            const { ipc } = loadPage();
            const callback = vi.fn(() => action);
            ipc.nobody.onOverflow(callback);

            sendMany(ipc.nobody.send, 2);

            expect(callback.mock.calls[1][1].dropped).toBe(1);
         }
      });

      it("is not called while the queue has room", () => {
         const { ipc } = loadPage();
         const callback = vi.fn(() => "dropOldest");
         ipc.chat.onOverflow(callback);

         sendMany(ipc.chat.send, 2);

         expect(callback).not.toHaveBeenCalled();
         expect(warn).not.toHaveBeenCalled();
      });
   });
});
