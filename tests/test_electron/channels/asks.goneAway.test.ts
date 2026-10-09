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

// Questions to a page that is destroyed, reloaded or crashed, in a real Electron process (see
// asks.answers.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   destroyed: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.silent.handle(() => {
            (window as any).asked = true;
            return new Promise(() => undefined);
         });
      });
      const pending = ctx.ipc.silent.invoke(win).then(
         () => ({ rejected: false }),
         (error: any) => ({ rejected: true, name: error.name, code: error.code }),
      );
      await ctx.until(win, () => (window as any).asked === true);
      win.destroy();
      const whilePending = await pending;
      // Asking a window which is gone fails at once.
      const afterwards = await ctx.ipc.silent.invoke(win).then(
         () => ({ rejected: false }),
         (error: any) => ({
            rejected: true,
            name: error.name,
            code: error.code,
            message: error.message,
         }),
      );
      return { whilePending, afterwards };
   },

   // The scenarios below cover T84 and T87. They read the state of the question after a pause, and
   // do not await it, so that they return what happened and do not fail with a timeout.

   // The page that was asked goes away, but its contents stay: a reload of the window, or a
   // navigation of the frame that was asked. The old document can no longer answer.
   askedPageGoesAway: async (ctx) => {
      const settleState = (promise: Promise<unknown>) => {
         const state = { value: "pending", settled: Promise.resolve() };
         state.settled = promise.then(
            (value) => {
               state.value = `resolved ${value}`;
            },
            (error: any) => {
               state.value = `rejected ${error.code}`;
            },
         );
         return state;
      };
      const answerLater = () => {
         ipc.delayed.handle((label: string, ms: number) => {
            (window as any).asked = true;
            return new Promise((resolve) => setTimeout(() => resolve(label), ms));
         });
      };
      const reloaded = await ctx.open();
      await ctx.evaluate(reloaded, answerLater);
      const onReload = settleState(ctx.ipc.delayed.invoke(reloaded, "a", 800));
      const navigated = await ctx.open();
      await ctx.evaluate(navigated, answerLater);
      const onNavigate = settleState(
         ctx.ipc.delayed.invoke(navigated.webContents.mainFrame, "b", 800),
      );
      await ctx.until(reloaded, () => (window as any).asked === true);
      await ctx.until(navigated, () => (window as any).asked === true);
      reloaded.webContents.reload();
      await navigated.webContents.loadURL("app://main/index.html?other");
      // Both questions should be rejected as soon as the document is replaced, long before the 800 ms
      // of the answers. A bug leaves them pending, which the result then shows.
      await Promise.race([Promise.all([onReload.settled, onNavigate.settled]), ctx.sleep(1500)]);
      return { reload: onReload.value, navigate: onNavigate.value };
   },

   // A renderer that crashed can never answer, and its contents are not destroyed.
   askCrashedRenderer: async (ctx) => {
      const win = await ctx.open();
      win.webContents.forcefullyCrashRenderer();
      await ctx.waitFor(() => win.webContents.isCrashed());
      const state = { value: "pending" };
      ctx.ipc.double.invoke(win, 2).then(
         (value: unknown) => {
            state.value = `resolved ${value}`;
         },
         (error: any) => {
            state.value = `rejected ${error.code}`;
         },
      );
      await ctx.sleep(1000);
      return { state: state.value, destroyed: win.isDestroyed() };
   },

   // Twelve questions in flight to one window are normal use.
   manyAsksAtOnce: async (ctx) => {
      const warnings: string[] = [];
      const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
      process.on("warning", onWarning);
      try {
         const win = await ctx.open();
         await ctx.evaluate(win, () => {
            ipc.delayed.handle(
               (label: string, ms: number) =>
                  new Promise((resolve) => setTimeout(() => resolve(label), ms)),
            );
         });
         const asks = [];
         for (let n = 0; n < 12; n++) {
            asks.push(ctx.ipc.delayed.invoke(win, `q${n}`, 200));
         }
         const answers = await Promise.all(asks);
         await ctx.sleep(50);
         return { answers: answers.length, warnings };
      } finally {
         process.off("warning", onWarning);
      }
   },
};

describeElectron(
   "ask channels, page gone away, in Electron",
   "electron-asks",
   scenarios,
   (group) => {
      it("rejects a question whose page reloads or whose frame navigates away", () => {
         expect(group.value("askedPageGoesAway")).toStrictEqual({
            reload: "rejected IPC_ASK_DESTROYED",
            navigate: "rejected IPC_ASK_DESTROYED",
         });
      });

      it("rejects a question to a renderer that crashed", () => {
         expect(group.value("askCrashedRenderer")).toStrictEqual({
            state: "rejected IPC_ASK_DESTROYED",
            destroyed: false,
         });
      });

      // Every question used to add a 'destroyed' and a 'render-process-gone' listener of its own (T87).
      it("asks a window many questions at once without a MaxListenersExceededWarning", () => {
         expect(group.value("manyAsksAtOnce")).toStrictEqual({ answers: 12, warnings: [] });
      });

      it("rejects with IPC_ASK_DESTROYED when the window is destroyed while it is asked", () => {
         expect(group.value("destroyed").whilePending).toStrictEqual({
            rejected: true,
            name: "IpcAskError",
            code: "IPC_ASK_DESTROYED",
         });
      });

      // The webContents of a destroyed BrowserWindow throws a TypeError in Electron, and not in the
      // fakes of the unit tests (T77).
      it("rejects with IPC_ASK_DESTROYED when the window was destroyed before it is asked", () => {
         expect(group.value("destroyed").afterwards).toMatchObject({
            rejected: true,
            name: "IpcAskError",
            code: "IPC_ASK_DESTROYED",
         });
      });
   },
);
