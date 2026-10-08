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
