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

// How the main process finds, attaches and loses a utility process, in a real Electron process (see
// utility.calls.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;
declare const IpcUtilityError: any;

const scenarios: Record<string, Scenario> = {
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

   // The child exits before a channel of the bindings first used it. It was forked by
   // forkUtility, so the bindings saw the exit. The scenario races the call with a pause, so that
   // it returns what happened and does not fail with a timeout.
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

   // A child that the bindings never saw is rejected, instead of leaving the call waiting for a
   // child that may be gone. attachUtility, called right after the fork, makes it known.
   notAttached: async (ctx) => {
      const child = await ctx.fork(
         () => {
            ipc.double.handle(async (n: number) => n * 2);
         },
         { bindings: false },
      );
      const codeOf = (error: any) => error.code;
      const call = await Promise.race([
         ctx.ipc.double.invoke(child, 2).then(() => "answered", codeOf),
         ctx.sleep(1500).then(() => "still pending"),
      ]);
      let send = "no error";
      try {
         ctx.ipc.start.send(child, 1);
      } catch (error: any) {
         send = error.code;
      }
      let handle = "no error";
      try {
         ctx.ipc.getSetting.handle(child, async () => "x");
      } catch (error: any) {
         handle = error.code;
      }
      ctx.main.attachUtility(child);
      const attached = await ctx.ipc.double.invoke(child, 4);
      return { call, send, handle, attached };
   },

   // forkUtility forks with the arguments of utilityProcess.fork, and returns the attached child.
   forkedByForkUtility: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => n * process.pid);
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      const before = (await ctx.ipc.double.invoke(child, 1)) === child.pid;
      child.kill();
      await exited;
      const after = await ctx.ipc.double.invoke(child, 1).then(
         () => "answered",
         (error: any) => error.code,
      );
      return { before, after, isUtilityProcess: typeof child.postMessage === "function" };
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

describeElectron(
   "utility channel lifecycle in Electron",
   "electron-utility",
   scenarios,
   (group) => {
      it("rejects a call and a send to a child that exited before its first use", () => {
         expect(group.value("exitedBeforeFirstUse")).toStrictEqual({
            call: "IPC_UTILITY_EXITED",
            send: "IPC_UTILITY_EXITED",
         });
      });

      it("rejects a child that was never attached with IPC_UTILITY_NOT_ATTACHED, and serves it once attached", () => {
         expect(group.value("notAttached")).toStrictEqual({
            call: "IPC_UTILITY_NOT_ATTACHED",
            send: "IPC_UTILITY_NOT_ATTACHED",
            handle: "IPC_UTILITY_NOT_ATTACHED",
            attached: 8,
         });
      });

      it("forks a child with forkUtility, which sees its exit", () => {
         expect(group.value("forkedByForkUtility")).toStrictEqual({
            before: true,
            after: "IPC_UTILITY_EXITED",
            isUtilityProcess: true,
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

      it("keeps two utility processes apart", () => {
         expect(group.value("twoChildren")).toStrictEqual({ distinct: true, one: true, two: true });
      });
   },
);
