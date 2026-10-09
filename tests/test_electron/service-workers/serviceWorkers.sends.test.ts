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

// Messages between a service worker and the main process, in a real Electron process (see
// serviceWorkers.calls.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // A worker sends to the main process.
   workerSends: async (ctx) => {
      const ses = ctx.workerSession();
      const heard: unknown[][] = [];
      const onceHeard: unknown[][] = [];
      ctx.ipc.syncDone.on(ses, (_event: any, ...args: unknown[]) => heard.push(args));
      ctx.ipc.syncDone.once(ses, (_event: any, ...args: unknown[]) => onceHeard.push(args));
      const { win } = await ctx.startWorker(ses);
      await ctx.inWorker(win, () => {
         ipc.syncDone.send(3, "first");
         ipc.syncDone.send(4, "second");
      });
      await ctx.waitFor(() => heard.length === 2, "two messages");
      return { heard, onceHeard };
   },

   // The main process sends to a worker.
   mainSends: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win, worker } = await ctx.startWorker(ses);
      await ctx.inWorker(win, () => {
         const g = globalThis as any;
         g.heard = [];
         g.onceHeard = [];
         g.off = ipc.configChanged.on((key: string, value: unknown) => g.heard.push([key, value]));
         ipc.configChanged.once((key: string) => g.onceHeard.push(key));
      });
      ctx.ipc.configChanged.send(worker, "theme", { dark: true });
      ctx.ipc.configChanged.broadcast(ses, "lang", "et");
      await ctx.until(win, () => true);
      const heard = await ctx.waitFor(async () => {
         const got = await ctx.inWorker(win, () => (globalThis as any).heard);
         return got.length >= 2 ? got : null;
      }, "two messages");
      const onceHeard = await ctx.inWorker(win, () => {
         (globalThis as any).off();
         return (globalThis as any).onceHeard;
      });
      ctx.ipc.configChanged.broadcast(ses, "after", "dispose");
      await ctx.sleep(200);
      const afterDispose = await ctx.inWorker(win, () => (globalThis as any).heard.length);
      return { heard, onceHeard, afterDispose };
   },
};

describeElectron(
   "service worker messages in real Electron",
   "electron-service-worker",
   scenarios,
   (group) => {
      it("delivers a message of the worker to the listeners of the session", () => {
         expect(group.value("workerSends")).toStrictEqual({
            heard: [
               [3, "first"],
               [4, "second"],
            ],
            onceHeard: [[3, "first"]],
         });
      });

      it("sends and broadcasts to the listeners of the worker", () => {
         expect(group.value("mainSends")).toStrictEqual({
            heard: [
               ["theme", { dark: true }],
               ["lang", "et"],
            ],
            onceHeard: ["theme"],
            afterDispose: 2,
         });
      });
   },
);
