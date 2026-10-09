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
   lastPort,
   loadBoundedProject,
   loadMain,
   range,
   sendMany,
} from "@testutils/e2e/port-queue-utils.js";
import { finishLoading } from "@testutils/e2e/runtime-utils.js";
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

describe("the send queue of a mainPort connection in the main process", () => {
   describe("the registration of the overflow callback", () => {
      it("uses the callback of the connection over the global one", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         connection.onOverflow(own);

         sendMany(connection.send, 4);

         expect(global).not.toHaveBeenCalled();
         expect(own).toHaveBeenCalledOnce();
      });

      it("goes back to the global callback when onOverflow(undefined) removes the override", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         connection.onOverflow(own);

         connection.onOverflow(undefined);
         sendMany(connection.send, 4);

         expect(global).toHaveBeenCalledOnce();
         expect(own).not.toHaveBeenCalled();
      });

      it("goes back to the global callback when the disposer removes the override", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const own = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         const { connection } = connectWaiting(main, "logTail");
         const dispose = connection.onOverflow(own);

         dispose();
         sendMany(connection.send, 4);

         expect(global).toHaveBeenCalledOnce();
      });

      it("replaces the previous override, whose disposer then removes nothing", () => {
         const main = loadMain();
         const first = vi.fn((queue: unknown[][]) => queue);
         const second = vi.fn((queue: unknown[][]) => queue);
         const { connection } = connectWaiting(main, "logTail");
         const disposeFirst = connection.onOverflow(first);
         connection.onOverflow(second);

         disposeFirst();
         sendMany(connection.send, 4);

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledOnce();
      });

      it("keeps the override of a connection apart from the other connections", () => {
         const main = loadMain();
         const own = vi.fn((queue: unknown[][]) => queue);
         const one = connectWaiting(main, "logTail");
         const two = connectWaiting(main, "logTail");
         one.connection.onOverflow(own);

         sendMany(two.connection.send, 4);

         expect(own).not.toHaveBeenCalled();
      });

      it("applies the global callback to connections that exist, and to every channel", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         const tail = connectWaiting(main, "logTail");
         const defaulted = connectWaiting(main, "defaulted");
         main.configurePorts({ onOverflow: global });

         sendMany(tail.connection.send, 4);
         sendMany(defaulted.connection.send, 1001);

         expect(global.mock.calls.map(([, , info]) => info.channel)).toStrictEqual([
            "logTail",
            "defaulted",
         ]);
      });

      it("removes the global callback with configurePorts({})", () => {
         const main = loadMain();
         const global = vi.fn((queue: unknown[][]) => queue);
         main.configurePorts({ onOverflow: global });
         main.configurePorts({});
         const { contents, connection } = connectWaiting(main, "logTail");

         sendMany(connection.send, 4);
         finishLoading(contents);

         expect(global).not.toHaveBeenCalled();
         expect(flushed()).toStrictEqual(range(2, 4));
      });
   });

   describe("the warnings", () => {
      it("warns at the first drop, not again until the 100th, and then at every 100th", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "meters");
         const send = (count: number) => sendMany(connection.send, count);

         send(1);
         expect(warn).toHaveBeenCalledTimes(1);
         send(98);
         expect(warn).toHaveBeenCalledTimes(1);
         send(1);
         expect(warn).toHaveBeenCalledTimes(2);
         send(99);
         expect(warn).toHaveBeenCalledTimes(2);
         send(1);
         expect(warn).toHaveBeenCalledTimes(3);
      });

      it("names the channel and the limit, and gives the counts", () => {
         const main = loadMain();
         const { connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 100);

         const [first] = warn.mock.calls[0];
         const [second] = warn.mock.calls[1];
         expect(first).toContain("'meters'");
         expect(first).toContain("maxQueue 0");
         expect(first).toContain("messages are being dropped");
         expect(first).toContain("Dropped so far: 1.");
         expect(first).toContain("Warnings so far: 1.");
         expect(second).toContain("Dropped so far: 100.");
         expect(second).toContain("Warnings so far: 2.");
      });

      it("hands the counts to the callback", () => {
         const main = loadMain();
         const callback = vi.fn(() => []);
         main.configurePorts({ onOverflow: callback });
         const { connection } = connectWaiting(main, "meters");

         sendMany(connection.send, 101);

         const infos = callback.mock.calls.map((call: unknown[]) => call[2]);
         expect(infos[0]).toStrictEqual({ channel: "meters", max: 0, dropped: 0, warnings: 0 });
         expect(infos[1]).toStrictEqual({ channel: "meters", max: 0, dropped: 1, warnings: 1 });
         expect(infos[100]).toStrictEqual({ channel: "meters", max: 0, dropped: 100, warnings: 2 });
      });

      it("does not reset the counts when a queue drains and overflows again", () => {
         const main = loadMain();
         const callback = vi.fn((queue: unknown[][], message: unknown[], _info: any) => [
            ...queue.slice(1),
            message,
         ]);
         main.configurePorts({ onOverflow: callback });
         const { contents, connection } = connectWaiting(main, "logTail");
         sendMany(connection.send, 4);
         finishLoading(contents);
         lastPort().emit("close");

         sendMany(connection.send, 4, "again");

         expect(callback.mock.calls[1][2]).toStrictEqual({
            channel: "logTail",
            max: 3,
            dropped: 1,
            warnings: 1,
         });
         expect(warn).toHaveBeenCalledOnce();
      });

      it("counts per connection, so each one warns for its own first drop", () => {
         const main = loadMain();
         const one = connectWaiting(main, "meters");
         const two = connectWaiting(main, "meters");

         one.connection.send("a");
         two.connection.send("b");

         expect(warn).toHaveBeenCalledTimes(2);
      });
   });
});
