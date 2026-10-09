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

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
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

   exitWhilePending: async (ctx) => {
      const describeFailure = (error: any, main: any) => ({
         isUtilityError: error instanceof main.IpcUtilityError,
         name: error.name,
         message: error.message,
         code: error.code,
         channel: error.channel,
         data: error.data,
      });
      const child = await ctx.fork(() => {
         ipc.hang.handle(() => new Promise(() => undefined));
         ipc.crash.on((code: number) => process.exit(code));
      });
      const pending = ctx.ipc.hang.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      await ctx.sleep(100);
      ctx.ipc.crash.send(child, 3);
      const whilePending = await pending;
      const afterwards = await ctx.ipc.hang.invoke(child).then(
         () => null,
         (error: any) => describeFailure(error, ctx.main),
      );
      const sendAfterwards = (() => {
         try {
            ctx.ipc.crash.send(child, 0);
            return null;
         } catch (error: any) {
            return describeFailure(error, ctx.main);
         }
      })();
      return { whilePending, afterwards, sendAfterwards };
   },

   // The child exits before a channel of the bindings first used it (T86). The scenario races the
   // call with a pause, so that it returns what happened and does not fail with a timeout.
   exitedBeforeFirstUse: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => n * 2);
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      const call = await Promise.race([
         ctx.ipc.double.invoke(child, 2).then(
            () => "answered",
            (error: any) => error.code,
         ),
         ctx.sleep(1500).then(() => "still pending"),
      ]);
      let send = "no error";
      try {
         ctx.ipc.start.send(child, 1);
      } catch (error: any) {
         send = error.code;
      }
      return { call, send };
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

   fromChild: async (ctx) => {
      const seen: unknown[] = [];
      let settingCalls = 0;
      const child = await ctx.fork(() => {
         ipc.start.on(async (total: number) => {
            for (let done = 1; done <= total; done++) {
               ipc.progress.send(done, total);
            }
         });
         ipc.viaMain.handle(async (key: string) => `${await ipc.getSetting.invoke(key)}!`);
      });
      ctx.ipc.progress.on(child, (done: number, total: number) => seen.push([done, total]));
      ctx.ipc.getSetting.handle(child, async (key: string) => {
         settingCalls++;
         return `value of ${key}`;
      });

      ctx.ipc.start.send(child, 3);
      const viaMain = await ctx.ipc.viaMain.invoke(child, "theme");
      await ctx.waitFor(() => seen.length === 3, "the progress messages");
      return { seen, viaMain, settingCalls };
   },

   mainFailureReachesChild: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.viaMain.handle(async (key: string) => {
            try {
               await ipc.getSetting.invoke(key);
               return "no error";
            } catch (error: any) {
               return JSON.stringify({
                  isUtilityError: error instanceof IpcUtilityError,
                  name: error.name,
                  message: error.message,
                  code: error.code,
                  data: error.data,
               });
            }
         });
      });
      // The child calls before the main process has a handler for it, once the peer is attached.
      ctx.main.attachUtility(child);
      const unhandled = JSON.parse(await ctx.ipc.viaMain.invoke(child, "missing"));
      ctx.ipc.getSetting.handle(child, async () => {
         throw Object.assign(new Error("denied"), { code: "E_DENIED", data: { who: "child" } });
      });
      const denied = JSON.parse(await ctx.ipc.viaMain.invoke(child, "secret"));
      return { unhandled, denied };
   },

   twoChildren: async (ctx) => {
      const entry = () => {
         ipc.double.handle(async (n: number) => n * process.pid);
      };
      const one = await ctx.fork(entry);
      const two = await ctx.fork(entry);
      return {
         distinct: one.pid !== two.pid,
         one: (await ctx.ipc.double.invoke(one, 1)) === one.pid,
         two: (await ctx.ipc.double.invoke(two, 1)) === two.pid,
      };
   },
};

describeElectron("utility channels in Electron", "electron-utility", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("runs every scenario to completion", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
   });

   // T86: the bindings listen for the 'exit' of a child only from its first use, so a child that
   // exited before is never marked as closed, and Electron drops what is posted to it.
   it.fails("rejects a call and a send to a child that exited before its first use", () => {
      expect(group.value("exitedBeforeFirstUse")).toStrictEqual({
         call: "IPC_UTILITY_EXITED",
         send: "IPC_UTILITY_EXITED",
      });
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

   it("rejects a pending call with IPC_UTILITY_EXITED when the process exits, and the later ones", () => {
      const result = group.value("exitWhilePending");
      expect(result.whilePending).toMatchObject({
         isUtilityError: true,
         code: "IPC_UTILITY_EXITED",
         channel: "autoipc:hang",
      });
      expect(result.afterwards).toMatchObject({ code: "IPC_UTILITY_EXITED" });
      expect(result.sendAfterwards).toMatchObject({ code: "IPC_UTILITY_EXITED" });
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

   it("delivers the notifications of the child, and the calls of the child to the main process", () => {
      expect(group.value("fromChild")).toStrictEqual({
         seen: [
            [1, 3],
            [2, 3],
            [3, 3],
         ],
         viaMain: "value of theme!",
         settingCalls: 1,
      });
   });

   it("rejects a call of the child with the error of the handler, or IPC_UTILITY_NO_HANDLER", () => {
      const { unhandled, denied } = group.value("mainFailureReachesChild");
      expect(unhandled).toMatchObject({
         isUtilityError: true,
         name: "IpcUtilityError",
         code: "IPC_UTILITY_NO_HANDLER",
      });
      expect(denied).toStrictEqual({
         isUtilityError: true,
         name: "Error",
         message: "denied",
         code: "E_DENIED",
         data: { who: "child" },
      });
   });

   it("keeps two utility processes apart", () => {
      expect(group.value("twoChildren")).toStrictEqual({ distinct: true, one: true, two: true });
   });
});
