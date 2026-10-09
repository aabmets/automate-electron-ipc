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

// The main process asking a service worker, in a real Electron process (see
// serviceWorkers.calls.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // The main process asks a worker.
   mainAsks: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win, worker } = await ctx.startWorker(ses);
      const noResponder = await ctx.ipc.flushQueue.invoke(worker, true).then(
         () => null,
         (error: any) => ({ name: error.name, code: error.code, channel: error.channel }),
      );
      await ctx.inWorker(win, () => {
         ipc.flushQueue.handle(async (force: boolean) => (force ? 7 : 0));
      });
      const answer = await ctx.ipc.flushQueue.invoke(worker, true);
      const withOptions = await ctx.ipc.flushQueue.invokeWith(worker, { timeoutMs: 5000 }, false);
      await ctx.inWorker(win, () => {
         // contextBridge keeps only the message of a synchronous throw, so the responder rejects.
         ipc.flushQueue.handle(() =>
            Promise.reject({
               name: "FlushError",
               message: "queue is locked",
               code: "LOCKED",
               data: { n: 1 },
            }),
         );
      });
      const failure = await ctx.ipc.flushQueue.invoke(worker, true).then(
         () => null,
         (error: any) => ({
            name: error.name,
            message: error.message,
            code: error.code,
            data: error.data,
            isError: error instanceof Error,
         }),
      );
      return { noResponder, answer, withOptions, failure };
   },

   askTimeout: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win, worker } = await ctx.startWorker(ses);
      await ctx.inWorker(win, () => {
         ipc.neverAnswers.handle(() => new Promise(() => undefined));
      });
      return await ctx.ipc.neverAnswers.invokeWith(worker, { timeoutMs: 150 }).then(
         () => null,
         (error: any) => ({ name: error.name, code: error.code }),
      );
   },

   askNotAttached: async (ctx) => {
      // Without a hub, nothing routes the worker, but the object can still be found by hand.
      const ses = ctx.workerSession();
      const { worker } = await ctx.startWorker(ses);
      return await ctx.ipc.flushQueue.invoke(worker, true).then(
         () => null,
         (error: any) => error.code,
      );
   },
};

describeElectron(
   "service worker asks in real Electron",
   "electron-service-worker",
   scenarios,
   (group) => {
      it("asks a worker and awaits the answer, or the error of its responder", () => {
         expect(group.value("mainAsks")).toStrictEqual({
            noResponder: { name: "IpcAskError", code: "IPC_ASK_NO_HANDLER", channel: "flushQueue" },
            answer: 7,
            withOptions: 0,
            failure: {
               name: "FlushError",
               message: "queue is locked",
               code: "LOCKED",
               data: { n: 1 },
               isError: true,
            },
         });
      });

      it("rejects a question that the worker does not answer in time", () => {
         expect(group.value("askTimeout")).toStrictEqual({
            name: "IpcAskError",
            code: "IPC_ASK_TIMEOUT",
         });
      });

      it("rejects a question to a worker that no hub knows", () => {
         expect(group.value("askNotAttached")).toBe("IPC_ASK_NOT_ATTACHED");
      });

      it("leaves no error behind in the main process", () => {
         expect(group.run().uncaught).toStrictEqual([]);
      });
   },
);
