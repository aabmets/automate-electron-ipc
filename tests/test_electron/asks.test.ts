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

// `ask` channels in a real Electron process: the main process asks a page, and the page answers.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   answer: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.double.handle(async (n: number) => n * 2);
      });
      return await ctx.ipc.double.invoke(win, 21);
   },

   targets: async (ctx) => {
      const { WebContentsView } = ctx.electron;
      const win = await ctx.open();
      const view = new WebContentsView({ webPreferences: ctx.webPreferences() });
      win.contentView.addChildView(view);
      await view.webContents.loadURL("app://main/view.html");
      for (const target of [win, view]) {
         await ctx.evaluate(target, () => {
            ipc.double.handle(async (n: number) => n * 2);
         });
      }
      return [
         await ctx.ipc.double.invoke(win, 1),
         await ctx.ipc.double.invoke(view, 2),
         await ctx.ipc.double.invoke(win.webContents, 3),
         await ctx.ipc.double.invoke(win.webContents.mainFrame, 4),
      ];
   },

   noHandler: async (ctx) => {
      const win = await ctx.open();
      try {
         await ctx.ipc.double.invokeWith(win, { timeoutMs: 2000 }, 1);
         return { rejected: false };
      } catch (error: any) {
         return { rejected: true, name: error.name, code: error.code, message: error.message };
      }
   },

   timeout: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.silent.handle(() => new Promise(() => undefined));
      });
      const started = Date.now();
      try {
         await ctx.ipc.silent.invokeWith(win, { timeoutMs: 150 });
         return { rejected: false };
      } catch (error: any) {
         return {
            rejected: true,
            name: error.name,
            code: error.code,
            channel: error.channel,
            elapsed: Date.now() - started,
         };
      }
   },

   destroyed: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.silent.handle(() => new Promise(() => undefined));
      });
      const pending = ctx.ipc.silent.invoke(win).then(
         () => ({ rejected: false }),
         (error: any) => ({ rejected: true, name: error.name, code: error.code }),
      );
      await ctx.sleep(100);
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

   concurrent: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.delayed.handle(
            (label: string, ms: number) =>
               new Promise((resolve) => setTimeout(() => resolve(`${label} answered`), ms)),
         );
      });
      const order: string[] = [];
      const ask = (label: string, ms: number) =>
         ctx.ipc.delayed.invoke(win, label, ms).then((answer: string) => {
            order.push(label);
            return answer;
         });
      // The slow question is asked first, and is answered last.
      const answers = await Promise.all([ask("slow", 300), ask("fast", 20), ask("middle", 100)]);
      return { answers, order };
   },

   pageError: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         let thrown = 0;
         ipc.failing.handle(async () => {
            thrown++;
            // contextBridge keeps only the message of an Error that crosses it, so the first call
            // throws a plain object, which the README tells responders to do, and the second an Error.
            if (thrown === 1) {
               // biome-ignore lint/style/useThrowOnlyError: a plain object is what the page should throw
               throw {
                  name: "PageError",
                  message: "the page failed",
                  code: "E_PAGE",
                  data: { n: 1 },
               };
            }
            const error: any = new Error("the page failed again");
            error.code = "E_PAGE";
            throw error;
         });
      });
      const attempt = async () => {
         try {
            await ctx.ipc.failing.invoke(win);
            return { rejected: false };
         } catch (error: any) {
            return {
               rejected: true,
               isAskError: error instanceof ctx.main.IpcAskError,
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
            };
         }
      };
      return { plain: await attempt(), error: await attempt() };
   },

   // The scenarios below cover T84 and T87. They read the state of the question after a pause, and
   // do not await it, so that they return what happened and do not fail with a timeout.

   // The page that was asked goes away, but its contents stay: a reload of the window, or a
   // navigation of the frame that was asked. The old document can no longer answer.
   askedPageGoesAway: async (ctx) => {
      const settleState = (promise: Promise<unknown>) => {
         const state = { value: "pending" };
         promise.then(
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
         ipc.delayed.handle(
            (label: string, ms: number) =>
               new Promise((resolve) => setTimeout(() => resolve(label), ms)),
         );
      };
      const reloaded = await ctx.open();
      await ctx.evaluate(reloaded, answerLater);
      const onReload = settleState(ctx.ipc.delayed.invoke(reloaded, "a", 800));
      const navigated = await ctx.open();
      await ctx.evaluate(navigated, answerLater);
      const onNavigate = settleState(
         ctx.ipc.delayed.invoke(navigated.webContents.mainFrame, "b", 800),
      );
      await ctx.sleep(100);
      reloaded.webContents.reload();
      await navigated.webContents.loadURL("app://main/index.html?other");
      await ctx.sleep(1500);
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

describeElectron("ask channels in Electron", "electron-asks", scenarios, (group) => {
   it("runs every scenario to completion, without uncaught errors in the main process", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
      expect(group.run().uncaught).toStrictEqual([]);
   });

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

   it("resolves with the answer of the page", () => {
      expect(group.value("answer")).toBe(42);
   });

   it("asks a window, a WebContentsView, WebContents and a frame", () => {
      expect(group.value("targets")).toStrictEqual([2, 4, 6, 8]);
   });

   it("rejects a question which the page did not register a handler for", () => {
      const result = group.value("noHandler");
      expect(result.rejected).toBe(true);
      expect(result.name).toBe("IpcAskError");
      expect(result.code).toBeDefined();
   });

   it("rejects with IPC_ASK_TIMEOUT when the page does not answer in time", () => {
      const result = group.value("timeout");
      expect(result).toMatchObject({
         rejected: true,
         name: "IpcAskError",
         code: "IPC_ASK_TIMEOUT",
         channel: "silent",
      });
      expect(result.elapsed).toBeGreaterThanOrEqual(100);
      expect(result.elapsed).toBeLessThan(2000);
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

   it("matches each answer to its question when questions overlap", () => {
      expect(group.value("concurrent")).toStrictEqual({
         answers: ["slow answered", "fast answered", "middle answered"],
         order: ["fast", "middle", "slow"],
      });
   });

   it("rejects with the fields of a plain object which the page handler throws", () => {
      expect(group.value("pageError").plain).toStrictEqual({
         rejected: true,
         isAskError: true,
         name: "PageError",
         message: "the page failed",
         code: "E_PAGE",
         data: { n: 1 },
      });
   });

   it("rejects with only the message of an Error which the page handler throws", () => {
      expect(group.value("pageError").error).toMatchObject({
         rejected: true,
         isAskError: true,
         message: "the page failed again",
      });
      expect(group.value("pageError").error.code).toBeUndefined();
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-asks");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
