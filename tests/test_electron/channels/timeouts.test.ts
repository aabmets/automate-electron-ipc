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

// Invoke timeouts in real Electron: the timer runs in the sandboxed preload script, and the
// rejection crosses the context bridge to the page.

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // `slow` has a timeout of 1000 ms of its own, and its handler never answers.
   timesOut: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.slow.handle(() => new Promise(() => undefined));
      return ctx.evaluate(win, async () => {
         const started = Date.now();
         try {
            await ipc.slow.invoke(1);
            return { settled: "resolved" };
         } catch (error: any) {
            return {
               settled: "rejected",
               isError: error instanceof Error,
               name: error.name,
               code: error.code,
               message: error.message,
               elapsed: Date.now() - started,
            };
         }
      });
   },

   // `legacy` times out after 300 ms; the answer that comes later must cause no error anywhere,
   // and the next call is answered normally.
   lateAnswer: async (ctx) => {
      const win = await ctx.open();
      let calls = 0;
      ctx.ipc.legacy.handle(async () => {
         calls += 1;
         if (calls === 1) {
            await ctx.sleep(600);
         }
      });
      const errors: string[] = [];
      win.webContents.on("console-message", (event: any) => {
         if (event.level === "error") {
            errors.push(event.message);
         }
      });
      const first = await ctx.evaluate(win, () =>
         ipc.legacy.invoke().then(
            () => "resolved",
            (error: any) => error.code,
         ),
      );
      await ctx.sleep(500);
      const second = await ctx.evaluate(win, () =>
         ipc.legacy.invoke().then(
            () => "resolved",
            (error: any) => error.code,
         ),
      );
      return { first, second, calls, errors };
   },

   // A handler that answers in time resolves, and the error of the handler is not the timeout.
   inTime: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.slow.handle(async (_event: unknown, id: number) => {
         await ctx.sleep(100);
         if (id < 0) {
            throw Object.assign(new Error("no such id"), {
               name: "NotFoundError",
               code: "NOT_FOUND",
            });
         }
         return `user ${id}`;
      });
      // `defaulted` uses the 2000 ms of the config, so an answer after 1200 ms is still in time.
      ctx.ipc.defaulted.handle(async () => {
         await ctx.sleep(1200);
         return 42;
      });
      return ctx.evaluate(win, async () => ({
         slow: await ipc.slow.invoke(2),
         failed: await ipc.slow.invoke(-1).catch((error: any) => [error.name, error.code]),
         defaulted: await ipc.defaulted.invoke(),
      }));
   },

   // `defaulted` uses the 2000 ms of the config.
   defaultTimeout: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.defaulted.handle(() => new Promise(() => undefined));
      return ctx.evaluate(win, async () => {
         const started = Date.now();
         const code = await ipc.defaulted.invoke().catch((error: any) => error.code);
         return { code, elapsed: Date.now() - started };
      });
   },

   // `patient` has no timeout, so an answer after the 2000 ms of the config still arrives.
   noTimeout: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.patient.handle(async () => {
         await ctx.sleep(2500);
         return "finally";
      });
      return ctx.evaluate(win, () => ipc.patient.invoke());
   },
};

describeElectron("invoke timeouts in Electron", "invoke-timeouts", scenarios, (group) => {
   it("runs every scenario to completion, without uncaught errors in the main process", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("rejects with the plain IpcTimeoutError once the timeout of the channel has passed", () => {
      const { elapsed, ...rest } = group.value("timesOut");
      expect(rest).toStrictEqual({
         settled: "rejected",
         isError: false,
         name: "IpcTimeoutError",
         code: "IPC_TIMEOUT",
         message: "The channel 'slow' did not answer within 1000 ms",
      });
      expect(elapsed).toBeGreaterThanOrEqual(950);
      expect(elapsed).toBeLessThan(1900);
   });

   it("drops an answer that comes after the timeout, and answers the next call", () => {
      expect(group.value("lateAnswer")).toStrictEqual({
         first: "IPC_TIMEOUT",
         second: "resolved",
         calls: 2,
         errors: [],
      });
   });

   it("resolves an answer in time, and rejects with the error of the handler", () => {
      expect(group.value("inTime")).toStrictEqual({
         slow: "user 2",
         failed: ["NotFoundError", "NOT_FOUND"],
         defaulted: 42,
      });
   });

   it("uses the timeout of the config for a channel without its own", () => {
      const { code, elapsed } = group.value("defaultTimeout");
      expect(code).toBe("IPC_TIMEOUT");
      expect(elapsed).toBeGreaterThanOrEqual(1950);
   });

   it("waits for as long as it takes with a timeout of 0", () => {
      expect(group.value("noTimeout")).toBe("finally");
   });
});
