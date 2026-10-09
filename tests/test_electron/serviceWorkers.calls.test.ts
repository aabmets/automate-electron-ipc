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

// Runs the generated service worker bindings in a real Electron process: a real service worker,
// registered by a page of a custom scheme, runs the generated preload script (sandboxed, with
// contextBridge) and talks to the generated `main.ts`. `ctx.inWorker` runs a function in the worker.

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // A worker calls the main process, and the handler sees the event of a service worker.
   workerCalls: async (ctx) => {
      const ses = ctx.workerSession();
      const seen: any[] = [];
      ctx.ipc.getToken.handle(ses, async (event: any, scope: string) => {
         seen.push({
            type: event.type,
            versionIsNumber: typeof event.versionId === "number",
            scope: event.serviceWorker.scope,
            hasSenderFrame: "senderFrame" in event,
         });
         return { value: "secret", scope };
      });
      ctx.ipc.add.handle(ses, (_event: any, a: number, b: number) => a + b);
      const { win } = await ctx.startWorker(ses);
      const token = await ctx.inWorker(win, () => ipc.getToken.invoke("app"));
      const sum = await ctx.inWorker(win, () => ipc.add.invoke(2, 3));
      return { token, sum, seen };
   },

   // Handlers are per session, so a worker that starts after the registration is routed as well.
   handlerRegisteredLate: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win } = await ctx.startWorker(ses);
      const before = await ctx.inWorker(win, () =>
         ipc.add.invoke(1, 1).then(
            () => null,
            (e: any) => e.code,
         ),
      );
      ctx.ipc.add.handle(ses, (_event: any, a: number, b: number) => a + b);
      const after = await ctx.inWorker(win, () => ipc.add.invoke(1, 1));
      return { before, after };
   },

   handlerErrors: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.ipc.getToken.handle(ses, () => {
         throw Object.assign(new Error("not signed in"), {
            name: "NotSignedInError",
            code: "NOT_SIGNED_IN",
            data: { retry: false },
         });
      });
      const { win } = await ctx.startWorker(ses);
      return await ctx.inWorker(win, async () => {
         try {
            await ipc.getToken.invoke("app");
            return null;
         } catch (error: any) {
            return { name: error.name, message: error.message, code: error.code, data: error.data };
         }
      });
   },

   handleOnceAndDispose: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.ipc.add.handleOnce(ses, (_event: any, a: number, b: number) => a + b);
      const disposeToken = ctx.ipc.getToken.handle(ses, async () => ({ value: "v", scope: "s" }));
      const { win } = await ctx.startWorker(ses);
      const first = await ctx.inWorker(win, () => ipc.add.invoke(1, 2));
      const second = await ctx.inWorker(win, () =>
         ipc.add.invoke(1, 2).then(
            () => null,
            (error: any) => error.code,
         ),
      );
      const beforeDispose = await ctx.inWorker(win, () => ipc.getToken.invoke("a"));
      disposeToken();
      const afterDispose = await ctx.inWorker(win, () =>
         ipc.getToken.invoke("a").then(
            () => null,
            (error: any) => error.code,
         ),
      );
      return { first, second, beforeDispose, afterDispose };
   },

   // A call whose handler never answers is rejected by the preload script of the worker.
   timeout: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.ipc.hang.handle(ses, () => new Promise(() => undefined));
      const { win } = await ctx.startWorker(ses);
      return await ctx.inWorker(win, async () => {
         const started = Date.now();
         const error: any = await ipc.hang.invoke().then(
            () => null,
            (e: any) => e,
         );
         return {
            name: error.name,
            code: error.code,
            message: error.message,
            waitedMs: Date.now() - started,
         };
      });
   },

   members: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win } = await ctx.startWorker(ses);
      return await ctx.inWorker(win, () => ({
         members: Object.keys(ipc).sort(),
         env: (globalThis as any).__env ?? null,
         type: typeof ipc.getToken.invoke,
      }));
   },
};

describeElectron(
   "service worker calls in real Electron",
   "electron-service-worker",
   scenarios,
   (group) => {
      it("exposes the API of the worker next to nothing of the page", () => {
         expect(group.value("members")).toStrictEqual({
            members: [
               "add",
               "allowed",
               "checked",
               "checkedSend",
               "configChanged",
               "flushQueue",
               "getToken",
               "hang",
               "neverAnswers",
               "restricted",
               "restrictedSend",
               "syncDone",
            ],
            env: null,
            type: "function",
         });
      });

      it("calls a handler of the main process, which gets the event of a service worker", () => {
         expect(group.value("workerCalls")).toStrictEqual({
            token: { value: "secret", scope: "app" },
            sum: 5,
            seen: [
               {
                  type: "service-worker",
                  versionIsNumber: true,
                  scope: "app://main/",
                  hasSenderFrame: false,
               },
            ],
         });
      });

      it("routes a worker to a handler that was registered after the worker started", () => {
         expect(group.value("handlerRegisteredLate")).toStrictEqual({
            before: "IPC_WORKER_NO_HANDLER",
            after: 2,
         });
      });

      it("rejects the call with the error object of the handler", () => {
         expect(group.value("handlerErrors")).toStrictEqual({
            name: "NotSignedInError",
            message: "not signed in",
            code: "NOT_SIGNED_IN",
            data: { retry: false },
         });
      });

      it("uses up handleOnce and stops at the disposer", () => {
         expect(group.value("handleOnceAndDispose")).toStrictEqual({
            first: 3,
            second: "IPC_WORKER_NO_HANDLER",
            beforeDispose: { value: "v", scope: "s" },
            afterDispose: "IPC_WORKER_NO_HANDLER",
         });
      });

      it("rejects a call whose handler never answers with the IpcTimeoutError", () => {
         const result = group.value("timeout");
         expect(result).toMatchObject({
            name: "IpcTimeoutError",
            code: "IPC_TIMEOUT",
            message: "The channel 'hang' did not answer within 300 ms",
         });
         expect(result.waitedMs).toBeGreaterThanOrEqual(250);
         expect(result.waitedMs).toBeLessThan(5000);
      });
   },
);
