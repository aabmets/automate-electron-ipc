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

// Runs the generated stream bindings in a real Electron process: the main process opens a real
// `MessageChannelMain`, and the sandboxed page reads the chunks of a generator from the port.

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

   // The port of a stream goes to the frame that opened it: an iframe and its main frame read
   // streams of their own at the same time.
   iframeStream: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://main/frame.html"></iframe>');
      ctx.serve("app://main/frame.html", "<p>frame</p>");
      const win = await ctx.open({ subframes: true });
      const frame = win.webContents.mainFrame.frames[0];
      ctx.ipc.count.handle(async function* (_event: unknown, to: number) {
         for (let n = 1; n <= to; n++) {
            yield n;
            await ctx.sleep(10);
         }
      });
      // A port that went to the wrong frame never arrives, so the read is raced with a pause.
      const read = (target: unknown, to: number) =>
         ctx.evaluate(
            target,
            (count: number) => {
               const chunks: number[] = [];
               const reading = (async () => {
                  for await (const n of ipc.count.stream(count)) {
                     chunks.push(n);
                  }
                  return chunks;
               })();
               const pause = new Promise((resolve) =>
                  setTimeout(() => resolve({ stuck: chunks }), 3000),
               );
               return Promise.race([reading, pause]);
            },
            to,
         );
      const [main, inFrame] = await Promise.all([read(win, 3), read(frame, 5)]);
      return { main, frame: inFrame };
   },

   // Twelve streams that one page reads at once are normal use (T87).
   manyStreams: async (ctx) => {
      const warnings: string[] = [];
      const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
      process.on("warning", onWarning);
      try {
         const win = await ctx.open();
         ctx.ipc.count.handle(async function* (_event: unknown, to: number) {
            for (let n = 1; n <= to; n++) {
               yield n;
               await ctx.sleep(20);
            }
         });
         const chunks = await ctx.evaluate(win, async () => {
            const streams = [];
            for (let i = 0; i < 12; i++) {
               streams.push(ipc.count.stream(5));
            }
            let total = 0;
            await Promise.all(
               streams.map(async (chunks: AsyncIterable<number>) => {
                  for await (const _ of chunks) {
                     total++;
                  }
               }),
            );
            return total;
         });
         await ctx.sleep(50);
         return { chunks, warnings };
      } finally {
         process.off("warning", onWarning);
      }
   },
};

describeElectron(
   "stream channels, reading, in Electron",
   "electron-streams",
   scenarios,
   (group) => {
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

      it("hands the port of a stream to the frame that opened it, which may be an iframe", () => {
         expect(group.value("iframeStream")).toStrictEqual({
            main: [1, 2, 3],
            frame: [1, 2, 3, 4, 5],
         });
      });

      // Every open stream used to add a 'destroyed' listener of its own to the contents of its page (T87).
      it("reads many streams of one page at once without a MaxListenersExceededWarning", () => {
         expect(group.value("manyStreams")).toStrictEqual({ chunks: 60, warnings: [] });
      });

      it("type-checks the generated files of the fixture", async () => {
         const project = await runFixture("electron-streams");
         try {
            expect(await project.typecheck()).toBe("");
         } finally {
            await project.cleanup();
         }
      }, 120_000);
   },
);
