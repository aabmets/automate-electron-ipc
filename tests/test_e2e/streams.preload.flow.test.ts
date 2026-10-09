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

import { cleanupStreams, settle } from "@testutils/stream-main-utils.js";
import { FakePagePort, loadPreload } from "@testutils/stream-preload-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, preload script, flow control", () => {
   const sentCredits = (port: FakePagePort) =>
      port.postMessage.mock.calls
         .map(([message]) => message as { type: string; limit?: number })
         .filter((message) => message.type === "credit")
         .map((message) => message.limit);
   const chunks = (port: FakePagePort, count: number, from = 0) => {
      for (let n = from; n < from + count; n++) {
         port.deliver({ type: "chunk", value: n });
      }
   };

   it("grants more once half of the window is read, as a total, so that the queue does not run dry", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.windowed.stream();
      const port = arrive("windowed", 1);
      chunks(port, 4);

      await stream.next();
      expect(sentCredits(port)).toStrictEqual([]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6]);
      await stream.next();
      expect(sentCredits(port)).toStrictEqual([6, 8]);
   });

   it("grants nothing while the page does not read", async () => {
      const { api, arrive } = await loadPreload();
      api.windowed.stream();
      const port = arrive("windowed", 1);

      chunks(port, 4);
      await settle();

      expect(sentCredits(port)).toStrictEqual([]);
   });

   it("grants the reads which wait first, when the window is 0, and the port has arrived later", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.pulled.stream();
      const first = stream.next();
      const second = stream.next();
      const port = arrive("pulled", 1);
      expect(sentCredits(port)).toStrictEqual([2]);

      chunks(port, 2);
      expect(await Promise.all([first, second])).toStrictEqual([
         { done: false, value: 0 },
         { done: false, value: 1 },
      ]);
      expect(sentCredits(port)).toStrictEqual([2]);

      const third = stream.next();
      expect(sentCredits(port)).toStrictEqual([2, 3]);
      port.deliver({ type: "end" });
      expect(await third).toStrictEqual({ done: true, value: undefined });
   });

   it("never grants when the window is infinite, or before the default window is half read", async () => {
      const { api, arrive } = await loadPreload();
      const unbounded = api.unbounded.stream();
      const unboundedPort = arrive("unbounded", 1);
      const standard = api.counter.stream();
      const standardPort = arrive("counter", 2);
      chunks(unboundedPort, 2000);
      chunks(standardPort, 2000);

      for (let read = 0; read < 511; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
         await standard.next();
      }
      expect(sentCredits(standardPort)).toStrictEqual([]);
      await standard.next();
      expect(sentCredits(standardPort)).toStrictEqual([1536]);

      for (let read = 0; read < 1400; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await unbounded.next();
      }
      expect(sentCredits(unboundedPort)).toStrictEqual([]);
   });

   it("grants nothing after the stream ended, failed or was cancelled", async () => {
      const { api, arrive } = await loadPreload();
      const ended = api.windowed.stream();
      const endedPort = arrive("windowed", 1);
      const cancelled = api.windowed.stream();
      const cancelledPort = arrive("windowed", 2);
      chunks(endedPort, 2);
      chunks(cancelledPort, 4);
      endedPort.deliver({ type: "end" });

      cancelled.cancel();
      await cancelled.next();
      await ended.next();
      await ended.next();

      expect(sentCredits(endedPort)).toStrictEqual([]);
      expect(sentCredits(cancelledPort)).toStrictEqual([]);
   });

   it("keeps reading when a grant cannot be posted, and grants the new total at the next read", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.windowed.stream();
      const port = arrive("windowed", 1);
      chunks(port, 8);
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("The port is closed");
      });

      const values: number[] = [];
      for (let read = 0; read < 4; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         values.push((await stream.next()).value);
      }

      expect(values).toStrictEqual([0, 1, 2, 3]);
      // The first attempt (6) threw, so the next read grants the total of that moment.
      expect(sentCredits(port)).toStrictEqual([6, 7]);
   });
});
