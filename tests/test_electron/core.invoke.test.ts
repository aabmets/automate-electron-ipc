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

// Runs the generated invoke bindings in a real Electron process: a sandboxed, context-isolated page
// talks to the generated main process code through the real ipcMain. The scenario functions are turned
// into text and run in Electron, so they use nothing from this file but `ctx`, and the page code in them
// uses the `ipc` global which the preload script exposes.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;
declare const __env: any;

const scenarios: Record<string, Scenario> = {
   environment: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, () => ({
         env: __env,
         members: Object.keys(ipc).sort(),
         invoke: typeof ipc.getValue.invoke,
      }));
   },

   invokeValue: async (ctx) => {
      const win = await ctx.open();
      const seen: unknown[] = [];
      ctx.ipc.getValue.handle(async (event: any, id: number) => {
         seen.push({ url: event.senderFrame.url, origin: event.senderFrame.origin, id });
         return `user ${id}`;
      });
      const value = await ctx.evaluate(win, () => ipc.getValue.invoke(7));
      return { value, seen };
   },

   invokeError: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.fail.handle(async (_event: unknown, id: number) => {
         const error = new Error("the app failed") as Error & { code: string; data: unknown };
         error.name = "AppError";
         error.code = "E_APP";
         error.data = { id, tags: ["a", "b"] };
         throw error;
      });
      return await ctx.evaluate(win, async () => {
         try {
            await ipc.fail.invoke(3);
            return { rejected: false };
         } catch (error: any) {
            return {
               rejected: true,
               isError: error instanceof Error,
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
               keys: Object.keys(error).sort(),
            };
         }
      });
   },

   invokeNoHandler: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, async () => {
         try {
            await ipc.missing.invoke();
            return { rejected: false };
         } catch (error: any) {
            return { rejected: true, message: String(error?.message ?? error) };
         }
      });
   },

   handleOnce: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.once.handleOnce(async () => 42);
      return await ctx.evaluate(win, async () => {
         const first = await ipc.once.invoke();
         let second: unknown;
         try {
            second = { value: await ipc.once.invoke() };
         } catch (error: any) {
            second = { message: String(error?.message ?? error) };
         }
         return { first, second };
      });
   },

   handlerReplaced: async (ctx) => {
      const win = await ctx.open();
      const invoke = () =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.replaced.invoke() };
            } catch (error: any) {
               return { message: String(error?.message ?? error) };
            }
         });
      const offFirst = ctx.ipc.replaced.handle(async () => "first");
      const before = await invoke();
      const offSecond = ctx.ipc.replaced.handle(async () => "second");
      const replaced = await invoke();
      // The disposer of a handler which was replaced must not remove the handler which replaced it.
      offFirst();
      const afterStale = await invoke();
      offSecond();
      const afterOwn = await invoke();
      return { before, replaced, afterStale, afterOwn };
   },
};

describeElectron("invoke channels in Electron", "electron-core", scenarios, (group) => {
   it("runs the preload script sandboxed and in an isolated context, and exposes the API", () => {
      expect(group.value("environment")).toStrictEqual({
         env: { sandboxed: true, contextIsolated: true },
         members: [
            "fail",
            "getValue",
            "log",
            "missing",
            "notice",
            "once",
            "optional",
            "replaced",
            "tick",
            "titleChanged",
         ],
         invoke: "function",
      });
   });

   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   describe("invoke", () => {
      it("returns the value of the handler, and passes the real sender frame", () => {
         const { value, seen } = group.value("invokeValue");
         expect(value).toBe("user 7");
         expect(seen).toStrictEqual([
            { url: "app://main/index.html", origin: "app://main", id: 7 },
         ]);
      });

      it("rejects with a plain object which has the fields of the error, and not with an Error", () => {
         expect(group.value("invokeError")).toStrictEqual({
            rejected: true,
            isError: false,
            name: "AppError",
            message: "the app failed",
            code: "E_APP",
            data: { id: 3, tags: ["a", "b"] },
            keys: ["code", "data", "message", "name"],
         });
      });

      it("rejects a call which has no handler", () => {
         const { rejected, message } = group.value("invokeNoHandler");
         expect(rejected).toBe(true);
         expect(message).toContain("No handler registered for 'autoipc:missing'");
      });

      it("answers the first call of handleOnce, and has no handler for the second", () => {
         const { first, second } = group.value("handleOnce");
         expect(first).toBe(42);
         expect(second.message).toContain("No handler registered for 'autoipc:once'");
      });

      it("uses the latest handler, and a stale disposer does not remove it", () => {
         const result = group.value("handlerReplaced");
         expect(result.before).toStrictEqual({ value: "first" });
         expect(result.replaced).toStrictEqual({ value: "second" });
         expect(result.afterStale).toStrictEqual({ value: "second" });
         expect(result.afterOwn.message).toContain("No handler registered for 'autoipc:replaced'");
      });
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-core");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
