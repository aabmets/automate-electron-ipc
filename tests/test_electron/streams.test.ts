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

// `stream` channels in a real Electron process: the chunks travel over a MessagePort that the main
// process hands to the frame which asked, and the page reads them through the preload script.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   chunks: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.count.handle(async function* (_event: unknown, to: number) {
         for (let n = 1; n <= to; n++) {
            yield n;
         }
      });
      return await ctx.evaluate(win, async () => {
         const stream = ipc.count.stream(5);
         const chunks: number[] = [];
         for (;;) {
            const step = await stream.next();
            if (step.done) {
               return { chunks, done: step };
            }
            chunks.push(step.value);
         }
      });
   },

   forAwait: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.count.handle(async function* (_event: unknown, to: number) {
         for (let n = 1; n <= to; n++) {
            yield n;
         }
      });
      return await ctx.evaluate(win, async () => {
         const stream = ipc.count.stream(3);
         const chunks: number[] = [];
         try {
            for await (const n of stream) {
               chunks.push(n);
            }
            return { chunks };
         } catch (error: any) {
            return { chunks, error: String(error?.message ?? error) };
         }
      });
   },

   cancel: async (ctx) => {
      const win = await ctx.open();
      let finalized = false;
      ctx.ipc.endless.handle(async function* () {
         try {
            for (let n = 1; ; n++) {
               yield n;
               await ctx.sleep(10);
            }
         } finally {
            finalized = true;
         }
      });
      const page = await ctx.evaluate(win, async () => {
         const stream = ipc.endless.stream();
         const chunks: number[] = [];
         while (chunks.length < 3) {
            chunks.push((await stream.next()).value);
         }
         stream.cancel();
         return { chunks, afterCancel: await stream.next() };
      });
      await ctx.waitFor(() => finalized, "the generator to be finalized");
      return { ...page, finalized };
   },

   return: async (ctx) => {
      const win = await ctx.open();
      let finalized = false;
      ctx.ipc.endless.handle(async function* () {
         try {
            for (let n = 1; ; n++) {
               yield n;
               await ctx.sleep(10);
            }
         } finally {
            finalized = true;
         }
      });
      const page = await ctx.evaluate(win, async () => {
         const stream = ipc.endless.stream();
         const first = await stream.next();
         const returned = await stream.return();
         return { first, returned, afterReturn: await stream.next() };
      });
      await ctx.waitFor(() => finalized, "the generator to be finalized");
      return { ...page, finalized };
   },

   failure: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.broken.handle(async function* (_event: unknown, failAt: number) {
         for (let n = 1; ; n++) {
            if (n === failAt) {
               const error = new Error("the stream failed") as Error & {
                  code: string;
                  data: unknown;
               };
               error.name = "StreamFailure";
               error.code = "E_STREAM";
               error.data = { at: n };
               throw error;
            }
            yield n;
         }
      });
      return await ctx.evaluate(win, async () => {
         const stream = ipc.broken.stream(3);
         const chunks: number[] = [];
         let failure: any = null;
         try {
            for (;;) {
               const step = await stream.next();
               if (step.done) {
                  break;
               }
               chunks.push(step.value);
            }
         } catch (error: any) {
            failure = {
               isError: error instanceof Error,
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
            };
         }
         return { chunks, failure, afterFailure: await stream.next() };
      });
   },

   slowReader: async (ctx) => {
      const win = await ctx.open();
      let produced = 0;
      let finalized = false;
      ctx.ipc.windowed.handle(async function* () {
         try {
            for (;;) {
               produced += 1;
               yield produced;
            }
         } finally {
            finalized = true;
         }
      });
      const read = await ctx.evaluate(win, async () => {
         const stream = ipc.windowed.stream();
         const chunks: number[] = [];
         for (let n = 0; n < 3; n++) {
            chunks.push((await stream.next()).value);
         }
         (globalThis as any).slow = stream;
         return chunks;
      });
      // The page reads nothing for a while, and the generator, which would run on, waits.
      await ctx.sleep(300);
      const pausedAt = produced;
      await ctx.sleep(300);
      const stillPausedAt = produced;
      const more = await ctx.evaluate(win, async () => {
         const stream = (globalThis as any).slow;
         const chunks: number[] = [];
         for (let n = 0; n < 6; n++) {
            chunks.push((await stream.next()).value);
         }
         stream.cancel();
         return chunks;
      });
      await ctx.waitFor(() => finalized, "the paused generator to be finalized");
      return { read, pausedAt, stillPausedAt, more, finalized };
   },

   pulled: async (ctx) => {
      const win = await ctx.open();
      let produced = 0;
      ctx.ipc.pulled.handle(async function* () {
         for (;;) {
            produced += 1;
            yield produced;
         }
      });
      const steps = await ctx.evaluate(win, async () => {
         const stream = ipc.pulled.stream();
         const chunks: number[] = [];
         for (let n = 0; n < 3; n++) {
            chunks.push((await stream.next()).value);
            await new Promise((resolve) => setTimeout(resolve, 100));
         }
         stream.cancel();
         return chunks;
      });
      return { steps, produced };
   },

   pausedCancel: async (ctx) => {
      const win = await ctx.open();
      let finalized = false;
      ctx.ipc.windowed.handle(async function* () {
         try {
            for (let n = 1; ; n++) {
               yield n;
            }
         } finally {
            finalized = true;
         }
      });
      await ctx.evaluate(win, async () => {
         const stream = ipc.windowed.stream();
         await stream.next();
         // The generator is paused by now, with the window full.
         await new Promise((resolve) => setTimeout(resolve, 200));
         stream.cancel();
      });
      await ctx.waitFor(() => finalized, "the paused generator to be finalized");
      return { finalized };
   },

   destroyed: async (ctx) => {
      const win = await ctx.open();
      let finalized = false;
      ctx.ipc.endless.handle(async function* () {
         try {
            for (let n = 1; ; n++) {
               yield n;
               await ctx.sleep(10);
            }
         } finally {
            finalized = true;
         }
      });
      await ctx.evaluate(win, async () => {
         const stream = ipc.endless.stream();
         await stream.next();
      });
      win.destroy();
      await ctx.waitFor(() => finalized, "the generator to be finalized");
      return { finalized };
   },
};

describeElectron("stream channels in Electron", "electron-streams", scenarios, (group) => {
   it("runs every scenario to completion, without uncaught errors in the main process", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("delivers all chunks in order, and then the end", () => {
      expect(group.value("chunks")).toStrictEqual({
         chunks: [1, 2, 3, 4, 5],
         done: { done: true },
      });
   });

   it("reads the stream with for await", () => {
      expect(group.value("forAwait")).toStrictEqual({ chunks: [1, 2, 3] });
   });

   it("stops the generator in the main process when the page cancels the stream", () => {
      expect(group.value("cancel")).toMatchObject({
         chunks: [1, 2, 3],
         afterCancel: { done: true },
         finalized: true,
      });
   });

   it("stops the generator in the main process when the page returns from the stream", () => {
      const result = group.value("return");
      expect(result.first).toStrictEqual({ done: false, value: 1 });
      expect(result.returned).toStrictEqual({ done: true });
      expect(result.afterReturn).toStrictEqual({ done: true });
      expect(result.finalized).toBe(true);
   });

   it("rejects the read with the fields of the error that the generator threw", () => {
      expect(group.value("failure")).toStrictEqual({
         chunks: [1, 2],
         failure: {
            isError: false,
            name: "StreamFailure",
            message: "the stream failed",
            code: "E_STREAM",
            data: { at: 3 },
         },
         afterFailure: { done: true },
      });
   });

   it("pauses the generator when the page does not read, and goes on when it does", () => {
      const result = group.value("slowReader");
      expect(result.read).toStrictEqual([1, 2, 3]);
      // The page has read 3 chunks, and granted a window of 4 on top of 2 that it counted.
      expect(result.pausedAt).toBeGreaterThanOrEqual(4);
      expect(result.pausedAt).toBeLessThanOrEqual(7);
      expect(result.stillPausedAt).toBe(result.pausedAt);
      expect(result.more).toStrictEqual([4, 5, 6, 7, 8, 9]);
      expect(result.finalized).toBe(true);
   });

   it("produces one chunk at a time for a reader that pulls, when the window is 0", () => {
      expect(group.value("pulled")).toStrictEqual({ steps: [1, 2, 3], produced: 3 });
   });

   it("stops a paused generator when the page cancels", () => {
      expect(group.value("pausedCancel")).toStrictEqual({ finalized: true });
   });

   it("stops the generator when the window of the reader is destroyed", () => {
      expect(group.value("destroyed")).toStrictEqual({ finalized: true });
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-streams");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
