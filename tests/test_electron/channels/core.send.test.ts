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

// Runs the generated send bindings and the subscribers of the preload script in a real Electron process
// (see core.invoke.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   sendArguments: async (ctx) => {
      const win = await ctx.open();
      const logged: unknown[][] = [];
      const optional: unknown[][] = [];
      // JSON has no undefined, so it is written out.
      const show = (args: unknown[]) => args.map((arg) => (arg === undefined ? "undefined" : arg));
      ctx.ipc.log.on((_event: unknown, ...args: unknown[]) => logged.push(show(args)));
      ctx.ipc.optional.on((_event: unknown, ...args: unknown[]) => optional.push(show(args)));
      await ctx.evaluate(win, () => {
         ipc.log.send("a");
         ipc.log.send("b", 1, 2, 3);
         ipc.optional.send("x");
         ipc.optional.send("y", 5);
      });
      await ctx.waitFor(() => logged.length === 2 && optional.length === 2);
      return { logged, optional };
   },

   sendOnce: async (ctx) => {
      const win = await ctx.open();
      const got: unknown[][] = [];
      ctx.ipc.log.once((_event: unknown, ...args: unknown[]) => got.push(args));
      await ctx.evaluate(win, () => {
         ipc.log.send("first");
         ipc.log.send("second");
      });
      await ctx.waitFor(() => got.length > 0);
      await ctx.sleep(200);
      return got;
   },

   // The disposers of the listeners on both sides (T14, T15), which cross the context bridge in
   // the page.
   listenerDisposers: async (ctx) => {
      const win = await ctx.open();
      const kept: unknown[] = [];
      const removed: unknown[] = [];
      ctx.ipc.log.on((_event: unknown, text: string) => kept.push(text));
      const off = ctx.ipc.log.on((_event: unknown, text: string) => removed.push(text));
      const offOnce = ctx.ipc.log.once((_event: unknown, text: string) => removed.push(text));
      await ctx.evaluate(win, () => ipc.log.send("before"));
      await ctx.waitFor(() => kept.length === 1);
      off();
      offOnce();
      await ctx.evaluate(win, () => ipc.log.send("after"));
      await ctx.waitFor(() => kept.length === 2);

      await ctx.evaluate(win, () => {
         const got: Record<string, number[]> = { kept: [], removed: [], once: [], onceOff: [] };
         (window as any).got = got;
         ipc.tick.on((n: number) => got.kept.push(n));
         (window as any).off = ipc.tick.on((n: number) => got.removed.push(n));
         ipc.tick.once((n: number) => got.once.push(n));
         ipc.tick.once((n: number) => got.onceOff.push(n))();
      });
      ctx.ipc.tick.send(win, 1);
      await ctx.until(win, () => (window as any).got.kept.length === 1);
      await ctx.evaluate(win, () => (window as any).off());
      ctx.ipc.tick.send(win, 2);
      const page = await ctx.until(
         win,
         () => (window as any).got.kept.length === 2 && (window as any).got,
      );
      return {
         main: { kept, removed },
         page,
         listeners: ctx.electron.ipcMain.listenerCount("autoipc:log"),
      };
   },

   // Eleven subscribers of one channel are normal use. ipcRenderer is an EventEmitter, and warns
   // (MaxListenersExceededWarning, on the console of the page) about more than ten listeners.
   manySubscribers: async (ctx) => {
      const win = await ctx.open();
      const messages: string[] = [];
      win.webContents.on("console-message", (...args: any[]) => {
         const details =
            args[0] && typeof args[0].message === "string" ? args[0] : { message: args[2] };
         messages.push(String(details.message));
      });
      await ctx.evaluate(win, () => {
         const got: number[][] = [];
         (window as any).got = got;
         for (let n = 0; n < 11; n++) {
            got.push([]);
            ipc.tick.on((value: number) => got[n].push(value));
         }
         const once: number[] = [];
         (window as any).once = once;
         for (let n = 0; n < 11; n++) {
            ipc.tick.once((value: number) => once.push(value));
         }
      });
      ctx.ipc.tick.send(win, 1);
      ctx.ipc.tick.send(win, 2);
      const page = await ctx.until(
         win,
         () =>
            (window as any).got.every((c: number[]) => c.length === 2) && {
               got: (window as any).got,
               once: (window as any).once,
            },
      );
      await ctx.sleep(200);
      return {
         first: page.got[0],
         last: page.got[10],
         onceCalls: page.once.length,
         warnings: messages.filter((m) => m.includes("MaxListenersExceeded")),
      };
   },

   // The subscribers of one channel share a listener, and still behave like separate ones.
   subscriberLifecycle: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         const log: string[] = [];
         (window as any).log = log;
         let offB: () => void = () => {};
         ipc.tick.on((n: number) => {
            log.push(`a${n}`);
            offB();
         });
         offB = ipc.tick.on((n: number) => log.push(`b${n}`));
         ipc.tick.on(() => {
            throw new Error("a subscriber failed");
         });
         ipc.tick.on((n: number) => log.push(`c${n}`));
         ipc.tick.once((n: number) => log.push(`o${n}`));
      });
      ctx.ipc.tick.send(win, 1);
      await ctx.until(win, () => (window as any).log.includes("c1"));
      ctx.ipc.tick.send(win, 2);
      return await ctx.until(win, () => (window as any).log.includes("c2") && (window as any).log);
   },
};

describeElectron(
   "send channels and subscribers in Electron",
   "electron-core",
   scenarios,
   (group) => {
      describe("send", () => {
         it("passes the rest parameters, and an omitted optional parameter as undefined", () => {
            expect(group.value("sendArguments")).toStrictEqual({
               logged: [["a"], ["b", 1, 2, 3]],
               optional: [
                  ["x", "undefined"],
                  ["y", 5],
               ],
            });
         });

         it("handles only the first message with once", () => {
            expect(group.value("sendOnce")).toStrictEqual([["first"]]);
         });
      });

      // The page of the preload script used one ipcRenderer listener per subscription (T94).
      it("lets a page subscribe many times to one channel without a MaxListenersExceededWarning", () => {
         expect(group.value("manySubscribers")).toStrictEqual({
            first: [1, 2],
            last: [1, 2],
            onceCalls: 11,
            warnings: [],
         });
      });

      it("keeps the order, the disposers and the once of the subscribers of a channel", () => {
         expect(group.value("subscriberLifecycle")).toStrictEqual(["a1", "c1", "o1", "a2", "c2"]);
      });

      it("removes exactly the listener of a disposer, in the main process and in the page", () => {
         expect(group.value("listenerDisposers")).toStrictEqual({
            main: { kept: ["before", "after"], removed: ["before", "before"] },
            page: { kept: [1, 2], removed: [1], once: [1], onceOff: [] },
            listeners: 1,
         });
      });
   },
);
