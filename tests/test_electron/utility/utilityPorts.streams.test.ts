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

// Streams from a utility process to a page, and their timeouts, in a real Electron process (see
// utilityPorts.calls.test.ts).

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   streams: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.count.handle(async function* (to: number) {
            for (let n = 1; n <= to; n++) {
               yield n;
            }
         });
         ipc.broken.handle(async function* (failAt: number) {
            for (let n = 1; ; n++) {
               if (n === failAt) {
                  throw Object.assign(new Error("the stream failed"), {
                     code: "E_BROKEN",
                     data: { at: n },
                  });
               }
               yield n;
            }
         });
      });
      const win = await ctx.open();
      ctx.ipc.count.connect(child, win);
      ctx.ipc.broken.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const collect = async (stream: AsyncIterable<number>) => {
            const chunks: number[] = [];
            for await (const n of stream) {
               chunks.push(n);
            }
            return chunks;
         };
         const chunks = await collect(ipc.count.stream(4));
         const partial: number[] = [];
         let failure: unknown = null;
         try {
            for await (const n of ipc.broken.stream(3)) {
               partial.push(n);
            }
         } catch (error: any) {
            failure = {
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
            };
         }
         // Two streams of one channel share the port.
         const [a, b] = await Promise.all([
            collect(ipc.count.stream(2)),
            collect(ipc.count.stream(3)),
         ]);
         return { chunks, partial, failure, a, b };
      });
   },

   cancel: async (ctx) => {
      const child = await ctx.fork(() => {
         let finalized = false;
         ipc.endless.handle(async function* () {
            try {
               for (let n = 1; ; n++) {
                  yield n;
                  await new Promise((resolve) => setTimeout(resolve, 10));
               }
            } finally {
               finalized = true;
            }
         });
         ipc.finalized.handle(async () => finalized);
      });
      const win = await ctx.open();
      ctx.ipc.endless.connect(child, win);
      const page = await ctx.evaluate(win, async () => {
         const stream = ipc.endless.stream();
         const chunks: number[] = [];
         while (chunks.length < 3) {
            chunks.push((await stream.next()).value);
         }
         stream.cancel();
         return { chunks, afterCancel: await stream.next() };
      });
      await ctx.waitFor(() => ctx.ipc.finalized.invoke(child), "the generator to be finalized");
      return page;
   },

   slowReader: async (ctx) => {
      const child = await ctx.fork(() => {
         let produced = 0;
         let finalized = false;
         ipc.windowed.handle(async function* () {
            try {
               for (;;) {
                  produced += 1;
                  yield produced;
               }
            } finally {
               finalized = true;
            }
         });
         ipc.produced.handle(async () => produced);
         ipc.finalized.handle(async () => finalized);
      });
      const win = await ctx.open();
      ctx.ipc.windowed.connect(child, win);
      const read = await ctx.evaluate(win, async () => {
         const stream = ipc.windowed.stream();
         const chunks: number[] = [];
         for (let n = 0; n < 3; n++) {
            chunks.push((await stream.next()).value);
         }
         (globalThis as any).slow = stream;
         return chunks;
      });
      await ctx.sleep(300);
      const pausedAt = await ctx.ipc.produced.invoke(child);
      await ctx.sleep(300);
      const stillPausedAt = await ctx.ipc.produced.invoke(child);
      const more = await ctx.evaluate(win, async () => {
         const stream = (globalThis as any).slow;
         const chunks: number[] = [];
         for (let n = 0; n < 6; n++) {
            chunks.push((await stream.next()).value);
         }
         stream.cancel();
         return chunks;
      });
      await ctx.waitFor(
         () => ctx.ipc.finalized.invoke(child),
         "the paused generator to be finalized",
      );
      return { read, pausedAt, stillPausedAt, more };
   },

   timeouts: async (ctx) => {
      let cancelled = 0;
      const child = await ctx.fork(() => {
         ipc.hangTimed.handle(() => new Promise(() => undefined));
         ipc.hang.handle(() => new Promise(() => undefined));
         ipc.hangStream.handle(async function* () {
            try {
               // A generator which is stuck in an await is stopped when it resumes.
               await new Promise((resolve) => setTimeout(resolve, 700));
               yield 1;
            } finally {
               (process as any).parentPort.postMessage({ finalized: true });
            }
         });
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      child.on("message", (message: any) => {
         if (message?.finalized) {
            cancelled += 1;
         }
      });
      const win = await ctx.open();
      for (const name of ["hangTimed", "hang", "hangStream", "query"]) {
         ctx.ipc[name].connect(child, win);
      }
      const page = await ctx.evaluate(win, async () => {
         const describe = (error: any) => ({ name: error.name, code: error.code });
         const started = Date.now();
         const call = await ipc.hangTimed.invoke().then(() => null, describe);
         const waited = Date.now() - started;
         const read = await ipc.hangStream
            .stream()
            .next()
            .then(() => null, describe);
         // A connection that holds no timeout waits.
         const patient = await Promise.race([
            ipc.hang.invoke().then(() => "answered", describe),
            new Promise((resolve) => setTimeout(() => resolve("still waiting"), 600)),
         ]);
         const later = await ipc.query.invoke("after");
         return { call, waited, read, patient, later };
      });
      await ctx.waitFor(() => cancelled === 1, "the generator to be stopped in the child");
      return { ...page, cancelled };
   },
};

describeElectron(
   "utility port streams in Electron",
   "electron-utility-ports",
   scenarios,
   (group) => {
      it("streams the chunks in order, ends, fails with the error of the generator, and shares the port", () => {
         expect(group.value("streams")).toStrictEqual({
            chunks: [1, 2, 3, 4],
            partial: [1, 2],
            failure: {
               name: "Error",
               message: "the stream failed",
               code: "E_BROKEN",
               data: { at: 3 },
            },
            a: [1, 2],
            b: [1, 2, 3],
         });
      });

      it("stops the generator in the child when the page cancels the stream", () => {
         const { chunks, afterCancel } = group.value("cancel");
         expect(chunks).toStrictEqual([1, 2, 3]);
         expect(afterCancel).toStrictEqual({ done: true });
      });

      it("pauses the generator in the child when the page does not read, and goes on when it does", () => {
         const result = group.value("slowReader");
         expect(result.read).toStrictEqual([1, 2, 3]);
         expect(result.pausedAt).toBeGreaterThanOrEqual(4);
         expect(result.pausedAt).toBeLessThanOrEqual(7);
         expect(result.stillPausedAt).toBe(result.pausedAt);
         expect(result.more).toStrictEqual([4, 5, 6, 7, 8, 9]);
      });

      it("rejects a call and a stream whose handler does not answer in time, and stops the generator in the child", () => {
         const result = group.value("timeouts");
         expect(result.call).toStrictEqual({
            name: "IpcUtilityError",
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(result.waited).toBeGreaterThanOrEqual(250);
         expect(result.waited).toBeLessThan(5000);
         expect(result.read).toStrictEqual({
            name: "IpcUtilityError",
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(result.cancelled).toBe(1);
         expect(result.patient).toBe("still waiting");
         expect(result.later).toStrictEqual([{ id: 1, label: "after" }]);
      });
   },
);
