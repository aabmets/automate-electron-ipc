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

// Runs the handlers and listeners of the webContents option in a real Electron process
// (see core.invoke.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   scopedInvoke: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      const call = (win: unknown, id: number) =>
         ctx.evaluate(win, (n: number) => ipc.getValue.invoke(n), id);
      const dispose = [
         ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `global ${id}`),
      ];
      const global = [await call(a, 1), await call(b, 1)];
      dispose.push(
         ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `scoped ${id}`, {
            webContents: a.webContents,
         }),
      );
      const withScoped = [await call(a, 2), await call(b, 2)];
      // The registration on the contents is not the global one, so it does not replace it.
      dispose[1]();
      const afterDispose = [await call(a, 3), await call(b, 3)];
      return { global, withScoped, afterDispose };
   },

   scopedInvokeOnly: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `only ${id}`, {
         webContents: a.webContents,
      });
      const call = (win: unknown) =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.getValue.invoke(1) };
            } catch (error: any) {
               return { message: String(error?.message ?? error) };
            }
         });
      return { a: await call(a), b: await call(b) };
   },

   scopedHandleOnce: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.getValue.handle(async () => "global");
      ctx.ipc.getValue.handleOnce(async () => "scoped once", { webContents: win.webContents });
      const call = () => ctx.evaluate(win, () => ipc.getValue.invoke(1));
      return [await call(), await call()];
   },

   scopedSend: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      const scoped: unknown[] = [];
      const global: unknown[] = [];
      const label = (event: any, text: string) =>
         `${event.sender.id === a.webContents.id ? "a" : "b"}:${text}`;
      ctx.ipc.log.on((event: any, text: string) => scoped.push(label(event, text)), {
         webContents: a.webContents,
      });
      ctx.ipc.log.on((event: any, text: string) => global.push(label(event, text)));
      await ctx.evaluate(a, () => ipc.log.send("one"));
      await ctx.evaluate(b, () => ipc.log.send("two"));
      await ctx.waitFor(() => global.length === 2);
      await ctx.sleep(100);
      return { scoped, global };
   },

   scopedSendOnce: async (ctx) => {
      const win = await ctx.open();
      const got: unknown[] = [];
      ctx.ipc.log.once((_event: unknown, text: string) => got.push(text), {
         webContents: win.webContents,
      });
      await ctx.evaluate(win, () => {
         ipc.log.send("first");
         ipc.log.send("second");
      });
      await ctx.waitFor(() => got.length > 0);
      await ctx.sleep(200);
      return got;
   },

   scopedDestroyed: async (ctx) => {
      const [gone, staying] = [await ctx.open(), await ctx.open()];
      const target = gone.webContents.ipc;
      const heard: unknown[] = [];
      ctx.ipc.getValue.handle(async () => "gone", { webContents: gone.webContents });
      ctx.ipc.getValue.handle(async () => "staying", { webContents: staying.webContents });
      ctx.ipc.log.on((_event: unknown, text: string) => heard.push(text), {
         webContents: gone.webContents,
      });
      ctx.ipc.log.on((_event: unknown, text: string) => heard.push(text), {
         webContents: staying.webContents,
      });
      const before = target.listenerCount("autoipc:log");

      gone.destroy();
      await ctx.waitFor(() => target.listenerCount("autoipc:log") === 0, "the listener is removed");
      // Electron refuses a second handler, so registering again shows that the first one is gone.
      let handlerRemoved = true;
      try {
         target.handle("autoipc:getValue", () => "again");
         target.removeHandler("autoipc:getValue");
      } catch {
         handlerRemoved = false;
      }
      let error: string | null = null;
      try {
         ctx.ipc.getValue.handle(async () => "late", { webContents: gone.webContents });
      } catch (cause: any) {
         error = String(cause?.message ?? cause);
      }
      const stayed = await ctx.evaluate(staying, () => ipc.getValue.invoke(1));
      await ctx.evaluate(staying, () => ipc.log.send("still"));
      await ctx.waitFor(() => heard.length > 0);
      return { before, handlerRemoved, error, stayed, heard };
   },

   scopedManyRegistrations: async (ctx) => {
      const win = await ctx.open();
      const warnings: string[] = [];
      process.on("warning", (warning: Error) => warnings.push(warning.name));
      // Electron has listeners of its own for this event.
      const baseline = win.webContents.listenerCount("destroyed");
      for (const name of ["getValue", "fail", "missing", "once", "replaced"]) {
         ctx.ipc[name].handle(async () => "x", { webContents: win.webContents });
      }
      for (let i = 0; i < 4; i++) {
         ctx.ipc.log.on(() => {}, { webContents: win.webContents });
         ctx.ipc.optional.once(() => {}, { webContents: win.webContents });
      }
      await ctx.sleep(100);
      return { added: win.webContents.listenerCount("destroyed") - baseline, warnings };
   },
};

describeElectron("the webContents option in Electron", "electron-core", scenarios, (group) => {
   describe("the webContents option", () => {
      it("answers an invoke from the handler of the contents before the global handler", () => {
         const result = group.value("scopedInvoke");
         expect(result.global).toStrictEqual(["global 1", "global 1"]);
         // Only the window whose contents the handler belongs to is answered by it.
         expect(result.withScoped).toStrictEqual(["scoped 2", "global 2"]);
         expect(result.afterDispose).toStrictEqual(["global 3", "global 3"]);
      });

      it("serves a channel with no global handler for its own window only", () => {
         const { a, b } = group.value("scopedInvokeOnly");
         expect(a).toStrictEqual({ value: "only 1" });
         expect(b.message).toContain("No handler registered for 'autoipc:getValue'");
      });

      it("answers one invoke with handleOnce, then the global handler is used", () => {
         expect(group.value("scopedHandleOnce")).toStrictEqual(["scoped once", "global"]);
      });

      it("delivers a send to the listener of the contents, and also to the global listener", () => {
         const { scoped, global } = group.value("scopedSend");
         expect(scoped).toStrictEqual(["a:one"]);
         expect([...global].sort()).toStrictEqual(["a:one", "b:two"]);
      });

      it("hands the first message only to once", () => {
         expect(group.value("scopedSendOnce")).toStrictEqual(["first"]);
      });

      it("removes the registrations when the window is destroyed, and keeps the others", () => {
         const result = group.value("scopedDestroyed");
         expect(result.before).toBe(1);
         expect(result.handlerRemoved).toBe(true);
         expect(result.stayed).toBe("staying");
         expect(result.heard).toStrictEqual(["still"]);
      });

      it("refuses contents which are already destroyed", () => {
         expect(group.value("scopedDestroyed").error).toBe("Object has been destroyed");
      });

      it("uses one destroyed listener for any number of registrations", () => {
         const { added, warnings } = group.value("scopedManyRegistrations");
         expect(added).toBe(1);
         expect(warnings).toStrictEqual([]);
      });
   });
});
