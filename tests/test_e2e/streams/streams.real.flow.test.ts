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

import { cleanupStreams } from "@testutils/e2e/stream-main-utils.js";
import { loadBoth } from "@testutils/e2e/stream-real-utils.js";
import { settle } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process and page, flow control over real message channels", () => {
   /** A generator which counts the chunks that it produced. */
   const counting = (state: { produced: number; finalized: boolean }) =>
      async function* () {
         try {
            for (;;) {
               state.produced += 1;
               yield state.produced;
            }
         } finally {
            state.finalized = true;
         }
      };

   it("keeps a fast generator within the window of a reader which stopped reading", async () => {
      const { ipc, api } = await loadBoth();
      const state = { produced: 0, finalized: false };
      ipc.windowed.handle(counting(state));

      const stream = api.windowed.stream();
      for (let read = 0; read < 3; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await stream.next();
      }
      await settle();
      await settle();

      // Three chunks are read, and the reader granted a window of 4 on top of those it read.
      expect(state.produced).toBeGreaterThanOrEqual(4);
      expect(state.produced).toBeLessThanOrEqual(3 + 4);
      const paused = state.produced;
      await settle();
      expect(state.produced).toBe(paused);

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("reads every chunk in order through many pauses, with a slow reader", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         for (let n = 0; n < 300; n++) {
            yield n;
         }
      });

      const seen: number[] = [];
      for await (const n of api.windowed.stream()) {
         seen.push(n);
         if (n % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 2));
         }
      }

      expect(seen).toStrictEqual(Array.from({ length: 300 }, (_, n) => n));
   });

   it("produces a chunk at a time for a reader that pulls, when the window is 0", async () => {
      const { ipc, api } = await loadBoth();
      const state = { produced: 0, finalized: false };
      ipc.pulled.handle(counting(state));

      const stream = api.pulled.stream();
      for (let read = 1; read <= 5; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         expect(await stream.next()).toStrictEqual({ done: false, value: read });
         await settle();
         expect(state.produced).toBe(read);
      }

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("ends a stream whose chunks exactly fill the window, and one that is shorter", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         yield* [1, 2, 3, 4];
      });
      ipc.pulled.handle(async function* () {
         yield* [1, 2];
      });

      const full: number[] = [];
      for await (const n of api.windowed.stream()) {
         full.push(n);
      }
      const pulled: number[] = [];
      for await (const n of api.pulled.stream()) {
         pulled.push(n);
      }

      expect(full).toStrictEqual([1, 2, 3, 4]);
      expect(pulled).toStrictEqual([1, 2]);
   });

   it("fails a paused stream with the error of the generator once the page reads on", async () => {
      const { ipc, api } = await loadBoth();
      ipc.windowed.handle(async function* () {
         yield* [1, 2, 3, 4];
         throw Object.assign(new Error("exploded"), { code: "E_BOOM" });
      });

      const seen: number[] = [];
      let failure: unknown;
      try {
         for await (const n of api.windowed.stream()) {
            seen.push(n);
         }
      } catch (error) {
         failure = error;
      }

      expect(seen).toStrictEqual([1, 2, 3, 4]);
      expect(failure).toMatchObject({ message: "exploded", code: "E_BOOM" });
   });
});
