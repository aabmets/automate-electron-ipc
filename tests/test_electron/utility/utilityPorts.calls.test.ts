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

// Calls from a page to a utility process, in a real Electron process: the main process forks a
// real `utilityProcess` and brokers a `MessageChannelMain` between it and a sandboxed window, and
// the page calls the child over the port without a hop through the main process.

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   invoke: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string, limit?: number) =>
            Array.from({ length: limit ?? 1 }, (_, id) => ({ id, label: `${sql} ${id}` })),
         );
         ipc.whoami.handle(async () => process.pid);
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      ctx.ipc.whoami.connect(child, win);
      const page = await ctx.evaluate(win, async () => ({
         rows: await ipc.query.invoke("select", 2),
         pid: await ipc.whoami.invoke(),
      }));
      return { ...page, childPid: child.pid, mainPid: process.pid };
   },

   concurrent: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => {
            await new Promise((resolve) => setTimeout(resolve, sql === "slow" ? 200 : 10));
            return [{ id: 0, label: sql }];
         });
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const order: string[] = [];
         const call = (sql: string) =>
            ipc.query.invoke(sql).then((rows: { label: string }[]) => {
               order.push(sql);
               return rows[0].label;
            });
         // The slow call is made first, and is answered last.
         const answers = await Promise.all([call("slow"), call("a"), call("b")]);
         return { answers, order };
      });
   },

   errors: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.fail.handle(async () => {
            throw Object.assign(new RangeError("out of range"), {
               code: "E_RANGE",
               data: { at: 3 },
            });
         });
         // A function cannot be cloned, so the reply cannot be posted.
         ipc.unsendable.handle(() => () => undefined);
         // Registered, so that the process has a handler for another channel.
         ipc.whoami.handle(async () => 1);
      });
      const win = await ctx.open();
      for (const channel of [ctx.ipc.fail, ctx.ipc.unregistered, ctx.ipc.unsendable]) {
         channel.connect(child, win);
      }
      return await ctx.evaluate(win, async () => {
         const settle = (call: Promise<unknown>) =>
            call.then(
               () => null,
               (error: any) => ({
                  name: error.name,
                  message: error.message,
                  code: error.code,
                  data: error.data,
                  isError: error instanceof Error,
               }),
            );
         return {
            fail: await settle(ipc.fail.invoke()),
            unregistered: await settle(ipc.unregistered.invoke()),
            unsendable: await settle(ipc.unsendable.invoke()),
         };
      });
   },

   waitsForConnect: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         (globalThis as any).early = ipc.query.invoke("early");
      });
      const before = await ctx.evaluate(win, () =>
         Promise.race([
            (globalThis as any).early.then(() => "answered"),
            new Promise((resolve) => setTimeout(() => resolve("waiting"), 150)),
         ]),
      );
      ctx.ipc.query.connect(child, win);
      const after = await ctx.evaluate(win, () => (globalThis as any).early);
      return { before, after };
   },

   withTheMainProcess: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => n * 2);
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      const [fromPage, fromMain] = await Promise.all([
         ctx.evaluate(win, () => ipc.query.invoke("page")),
         ctx.ipc.double.invoke(child, 21),
      ]);
      return { fromPage, fromMain };
   },
};

describeElectron("utility port calls in Electron", "electron-utility-ports", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("runs every scenario to completion", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
   });

   it("calls the handlers of a real utility process from a sandboxed page, with no hop through main", () => {
      const result = group.value("invoke");
      expect(result.rows).toStrictEqual([
         { id: 0, label: "select 0" },
         { id: 1, label: "select 1" },
      ]);
      expect(result.pid).toBe(result.childPid);
      expect(result.pid).not.toBe(result.mainPid);
   });

   it("answers concurrent calls by their IDs", () => {
      expect(group.value("concurrent")).toStrictEqual({
         answers: ["slow", "a", "b"],
         order: ["a", "b", "slow"],
      });
   });

   it("rejects with the error of the handler as a plain object, and with the library's codes", () => {
      const { fail, unregistered, unsendable } = group.value("errors");
      expect(fail).toStrictEqual({
         name: "RangeError",
         message: "out of range",
         code: "E_RANGE",
         data: { at: 3 },
         isError: false,
      });
      expect(unregistered).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_NO_HANDLER",
      });
      expect(unsendable).toMatchObject({ name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" });
   });

   it("holds a call which is made before the main process connects, and sends it afterwards", () => {
      expect(group.value("waitsForConnect")).toStrictEqual({
         before: "waiting",
         after: [{ id: 1, label: "early" }],
      });
   });

   it("works next to the calls of the main process to the same child", () => {
      expect(group.value("withTheMainProcess")).toStrictEqual({
         fromPage: [{ id: 1, label: "page" }],
         fromMain: 42,
      });
   });
});
