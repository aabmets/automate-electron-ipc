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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import {
   cleanupUtilityPorts,
   FakePagePort,
   loadPage,
   wire,
} from "@testutils/e2e/utility-port-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the page, flow control", () => {
   const credits = (port: FakePagePort) =>
      port.posted("credit").map((message) => ({ id: message.id, limit: message.limit }));
   const chunks = (port: FakePagePort, name: string, id: number, count: number) => {
      for (let n = 0; n < count; n++) {
         port.deliver({ __ipc: "chunk", channel: wire(name), id, value: n });
      }
   };

   it("grants more once half of the window is read, as a total", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("windowedRows");
      const stream = api.windowedRows.stream();
      const [start] = port.posted("stream");
      chunks(port, "windowedRows", start.id, 4);

      await stream.next();
      expect(credits(port)).toStrictEqual([]);
      await stream.next();
      expect(credits(port)).toStrictEqual([{ id: start.id, limit: 6 }]);
      await stream.next();
      await stream.next();
      expect(credits(port)).toStrictEqual([
         { id: start.id, limit: 6 },
         { id: start.id, limit: 8 },
      ]);
      expect(port.posted("credit")[0].channel).toBe(wire("windowedRows"));
   });

   it("grants the reads which wait only after the stream is started, when the window is 0", async () => {
      const { api, arrive } = await loadPage();
      const stream = api.pulledRows.stream();
      const first = stream.next();
      const port = arrive("pulledRows");
      const [start] = port.posted("stream");
      expect(credits(port)).toStrictEqual([{ id: start.id, limit: 1 }]);

      chunks(port, "pulledRows", start.id, 1);
      expect(await first).toStrictEqual({ done: false, value: 0 });
      const second = stream.next();
      expect(credits(port)).toStrictEqual([
         { id: start.id, limit: 1 },
         { id: start.id, limit: 2 },
      ]);
      port.deliver({ __ipc: "end", channel: wire("pulledRows"), id: start.id });
      expect(await second).toStrictEqual({ done: true, value: undefined });
   });

   it("grants nothing before the stream is started, nor on an infinite window", async () => {
      const { api, arrive } = await loadPage();
      const early = api.windowedRows.stream();
      const unbounded = api.unboundedRows.stream();
      const port = arrive("windowedRows");
      const other = arrive("unboundedRows");
      const [start] = other.posted("stream");
      chunks(other, "unboundedRows", start.id, 100);

      for (let read = 0; read < 100; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
      }

      expect(credits(other)).toStrictEqual([]);
      expect(credits(port)).toStrictEqual([]);
      early.cancel();
   });

   it("grants nothing for another call, and nothing after the end", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("windowedRows");
      const one = api.windowedRows.stream();
      const two = api.windowedRows.stream();
      const [first, second] = port.posted("stream");
      chunks(port, "windowedRows", first.id, 2);
      chunks(port, "windowedRows", second.id, 4);
      port.deliver({ __ipc: "end", channel: wire("windowedRows"), id: first.id });

      await one.next();
      await one.next();
      await two.next();
      await two.next();

      expect(credits(port)).toStrictEqual([{ id: second.id, limit: 6 }]);
   });
});
