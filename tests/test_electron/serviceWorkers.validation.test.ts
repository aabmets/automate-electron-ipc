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

// The origin checks and the argument validation of the calls of a service worker, in a real Electron
// process (see serviceWorkers.calls.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
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
};

describeElectron(
   "service worker origins and validation in real Electron",
   "electron-service-worker",
   scenarios,
   (group) => {
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

      it("lets validateSender reject a call, with the scope and the version of the worker", () => {
         const result = group.value("validateSender");
         expect(result.code).toBe("IPC_WORKER_FORBIDDEN");
         expect(result.calls).toHaveLength(1);
         expect(result.calls[0].channel).toBe("add");
         expect(result.calls[0].scope).toBe("app://main/");
         expect(typeof result.calls[0].versionId).toBe("number");
      });
   },
);
