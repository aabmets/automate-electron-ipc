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

   // The origin of the scope of the worker is compared with `allowedOrigins`.
   origins: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.ipc.restricted.handle(ses, () => "restricted");
      ctx.ipc.allowed.handle(ses, () => "allowed");
      const sent: string[] = [];
      ctx.ipc.restrictedSend.on(ses, () => sent.push("restrictedSend"));
      const rejected: string[] = [];
      ctx.main.configureServiceWorkerIpc({
         onRejected: (event: any, channel: string) => rejected.push(`${channel}:${event.type}`),
      });
      const { win } = await ctx.startWorker(ses);
      const outcome = await ctx.inWorker(win, async () => {
         const result: Record<string, unknown> = {};
         try {
            result.restricted = (await ipc.getToken.invoke) ? null : null;
         } catch {}
         result.allowed = await ipc.allowed.invoke();
         try {
            await ipc.restricted.invoke();
            result.restricted = "ran";
         } catch (error: any) {
            result.restricted = { name: error.name, code: error.code };
         }
         ipc.restrictedSend.send();
         return result;
      });
      await ctx.sleep(200);
      return { outcome, rejected, sent };
   },

   // The arguments of a call and of a message are validated before the callback runs.
   validation: async (ctx) => {
      const ses = ctx.workerSession();
      const handled: unknown[][] = [];
      ctx.ipc.checked.handle(ses, (_event: any, ...args: unknown[]) => {
         handled.push(args);
         return "handled";
      });
      const heard: unknown[][] = [];
      ctx.ipc.checkedSend.on(ses, (_event: any, ...args: unknown[]) => heard.push(args));
      const rejected: { channel: string; name: string; code: string }[] = [];
      ctx.main.configureServiceWorkerIpc({
         onRejected: (_event: any, channel: string, error: any) =>
            rejected.push({ channel, name: error.name, code: error.code }),
      });
      const { win } = await ctx.startWorker(ses);
      const outcome = await ctx.inWorker(win, async () => {
         const failure = (error: any) => ({
            name: error.name,
            code: error.code,
            message: error.message,
            data: error.data,
         });
         const result: Record<string, unknown> = {};
         result.valid = await ipc.checked.invoke(7);
         result.invalid = await ipc.checked.invoke("seven").catch(failure);
         result.extra = await ipc.checked.invoke(1, 2).catch(failure);
         ipc.checkedSend.send("bad");
         ipc.checkedSend.send(5);
         return result;
      });
      await ctx.waitFor(() => heard.length === 1, "the valid message");
      await ctx.sleep(200);
      return { outcome, handled, heard, rejected };
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

   validateSender: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.ipc.add.handle(ses, (_event: any, a: number, b: number) => a + b);
      const calls: any[] = [];
      ctx.main.configureServiceWorkerIpc({
         validateSender: (event: any, channel: string) => {
            calls.push({ channel, scope: event.serviceWorker.scope, versionId: event.versionId });
            return false;
         },
      });
      const { win } = await ctx.startWorker(ses);
      const code = await ctx.inWorker(win, () =>
         ipc.add.invoke(1, 2).then(
            () => null,
            (error: any) => error.code,
         ),
      );
      return { code, calls };
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
   "service worker channels in real Electron",
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

      it("delivers a message of the worker to the listeners of the session", () => {
         expect(group.value("workerSends")).toStrictEqual({
            heard: [
               [3, "first"],
               [4, "second"],
            ],
            onceHeard: [[3, "first"]],
         });
      });

      it("compares allowedOrigins with the origin of the scope of the worker", () => {
         expect(group.value("origins")).toStrictEqual({
            outcome: {
               allowed: "allowed",
               restricted: { name: "IpcWorkerError", code: "IPC_WORKER_FORBIDDEN" },
            },
            rejected: ["restricted:service-worker", "restrictedSend:service-worker"],
            sent: [],
         });
      });

      it("validates the arguments of a call and of a message, and tells onRejected", () => {
         const result = group.value("validation");
         expect(result.outcome.valid).toBe("handled");
         expect(result.outcome.invalid).toStrictEqual({
            name: "IpcValidationError",
            code: "IPC_VALIDATION",
            message: "The arguments of the channel 'checked' are invalid: expected one number",
            data: [{ message: "expected one number", path: [0] }],
         });
         expect(result.outcome.extra).toMatchObject({ code: "IPC_VALIDATION" });
         // Only the valid call and the valid message get as far as the callbacks.
         expect(result.handled).toStrictEqual([[7]]);
         expect(result.heard).toStrictEqual([[5]]);
         const invalid = { name: "IpcValidationError", code: "IPC_VALIDATION" };
         expect(result.rejected).toStrictEqual([
            { channel: "checked", ...invalid },
            { channel: "checked", ...invalid },
            { channel: "checkedSend", ...invalid },
         ]);
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

      it("lets validateSender reject a call, with the scope and the version of the worker", () => {
         const result = group.value("validateSender");
         expect(result.code).toBe("IPC_WORKER_FORBIDDEN");
         expect(result.calls).toHaveLength(1);
         expect(result.calls[0].channel).toBe("add");
         expect(result.calls[0].scope).toBe("app://main/");
         expect(typeof result.calls[0].versionId).toBe("number");
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
