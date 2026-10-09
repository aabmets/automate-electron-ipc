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

// Channels to a utility process, in a real Electron process: the main process forks a real
// `utilityProcess` which loads the generated `utility.ts`, and the two talk over `parentPort`.

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;
declare const IpcUtilityError: any;

const scenarios: Record<string, Scenario> = {
   roundTrip: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => n * 2);
         ipc.rows.handle((count: number) =>
            Array.from({ length: count }, (_, id) => ({ id, label: `row ${id}` })),
         );
      });
      return {
         double: await ctx.ipc.double.invoke(child, 21),
         rows: await ctx.ipc.rows.invoke(child, 2),
      };
   },

   concurrent: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => {
            await new Promise((resolve) => setTimeout(resolve, n === 1 ? 200 : 10));
            return n * 2;
         });
      });
      const order: number[] = [];
      const call = (n: number) =>
         ctx.ipc.double.invoke(child, n).then((answer: number) => {
            order.push(n);
            return answer;
         });
      // The slow call is made first, and is answered last.
      const answers = await Promise.all([call(1), call(2), call(3)]);
      return { answers, order };
   },

   errors: async (ctx) => {
      const describeFailure = (error: any, main: any) => ({
         isUtilityError: error instanceof main.IpcUtilityError,
         name: error.name,
         message: error.message,
         code: error.code,
         channel: error.channel,
         data: error.data,
      });
      const child = await ctx.fork(() => {
         ipc.fail.handle(async () => {
            throw Object.assign(new RangeError("out of range"), {
               code: "E_RANGE",
               data: { at: 3 },
            });
         });
         // Registered, so that the process has a handler for another channel.
         ipc.double.handle(async (n: number) => n);
      });
      const failure = await ctx.ipc.fail.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      const unregistered = await ctx.ipc.unregistered.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      return { failure, unregistered };
   },

   unsendable: async (ctx) => {
      const describeFailure = (error: any, main: any) => ({
         isUtilityError: error instanceof main.IpcUtilityError,
         name: error.name,
         message: error.message,
         code: error.code,
         channel: error.channel,
         data: error.data,
      });
      const child = await ctx.fork(() => {
         // A function cannot be cloned, so the reply cannot be posted.
         ipc.unsendable.handle(() => () => undefined);
      });
      return await ctx.ipc.unsendable.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
   },

   timeouts: async (ctx) => {
      const describeFailure = (error: any, main: any) => ({
         isUtilityError: error instanceof main.IpcUtilityError,
         name: error.name,
         code: error.code,
         channel: error.channel,
      });
      const child = await ctx.fork(() => {
         ipc.hangTimed.handle(() => new Promise(() => undefined));
         ipc.delayed.handle(async (ms: number) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return `after ${ms}`;
         });
         ipc.viaMain.handle(async (key: string) => {
            try {
               await ipc.hangSetting.invoke(key);
               return "no error";
            } catch (error: any) {
               return JSON.stringify({
                  isUtilityError: error instanceof IpcUtilityError,
                  code: error.code,
                  channel: error.channel,
               });
            }
         });
      });
      const started = Date.now();
      const hung = await ctx.ipc.hangTimed.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      const waited = Date.now() - started;
      // A call that is answered in time is not affected, and the late reply of a call that timed
      // out is dropped without disturbing the next call.
      const inTime = await ctx.ipc.delayed.invoke(child, 10);
      const late = await ctx.ipc.delayed.invoke(child, 600).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      await ctx.sleep(500);
      const afterLate = await ctx.ipc.delayed.invoke(child, 10);
      // The main process never answers the call of the child.
      ctx.ipc.hangSetting.handle(child, () => new Promise(() => undefined));
      const fromChild = JSON.parse(await ctx.ipc.viaMain.invoke(child, "theme"));
      return { hung, waited, inTime, late, afterLate, fromChild };
   },
};

describeElectron("utility channel calls in Electron", "electron-utility", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("runs every scenario to completion", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
   });

   it("calls the handlers of a real utility process", () => {
      expect(group.value("roundTrip")).toStrictEqual({
         double: 42,
         rows: [
            { id: 0, label: "row 0" },
            { id: 1, label: "row 1" },
         ],
      });
   });

   it("answers concurrent calls by their IDs", () => {
      expect(group.value("concurrent")).toStrictEqual({ answers: [2, 4, 6], order: [2, 3, 1] });
   });

   it("rejects with the error, its code and data, and with IPC_UTILITY_NO_HANDLER", () => {
      const { failure, unregistered } = group.value("errors");
      expect(failure).toStrictEqual({
         isUtilityError: true,
         name: "RangeError",
         message: "out of range",
         code: "E_RANGE",
         channel: "autoipc:fail",
         data: { at: 3 },
      });
      expect(unregistered).toMatchObject({
         isUtilityError: true,
         name: "IpcUtilityError",
         code: "IPC_UTILITY_NO_HANDLER",
         channel: "autoipc:unregistered",
      });
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the result of the handler cannot be cloned", () => {
      expect(group.value("unsendable")).toMatchObject({
         isUtilityError: true,
         code: "IPC_UTILITY_UNSENDABLE",
         channel: "autoipc:unsendable",
      });
   });

   it("rejects a call that the handler does not answer in time with IPC_UTILITY_TIMEOUT, and drops its late reply", () => {
      const result = group.value("timeouts");
      expect(result.hung).toStrictEqual({
         isUtilityError: true,
         name: "IpcUtilityError",
         code: "IPC_UTILITY_TIMEOUT",
         channel: "autoipc:hangTimed",
      });
      expect(result.waited).toBeGreaterThanOrEqual(250);
      expect(result.waited).toBeLessThan(5000);
      expect(result.inTime).toBe("after 10");
      expect(result.late).toMatchObject({
         code: "IPC_UTILITY_TIMEOUT",
         channel: "autoipc:delayed",
      });
      expect(result.afterLate).toBe("after 10");
   });

   it("rejects a call of the child that the main process does not answer in time", () => {
      expect(group.value("timeouts").fromChild).toStrictEqual({
         isUtilityError: true,
         code: "IPC_UTILITY_TIMEOUT",
         channel: "autoipc:hangSetting",
      });
   });
});
