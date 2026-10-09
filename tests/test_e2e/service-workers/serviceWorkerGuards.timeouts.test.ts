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

import {
   createSession,
   createWorker,
   loadGuardMain,
   oneNumber,
   oneString,
   schema,
} from "@testutils/e2e/service-worker-guard-utils.js";
import { ok } from "@testutils/e2e/service-worker-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.useRealTimers();
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

describe("timeouts of the calls of a worker, in the main process", () => {
   let main: any;
   let one: ReturnType<typeof createWorker>;
   let session: any;

   beforeEach(async () => {
      project = await runFixture("service-worker-guards");
      main = loadGuardMain(project, {
         __esModule: true,
         scopeArgs: schema(oneString),
         stateArgs: schema(oneNumber),
         slowArgs: schema(oneString),
      });
      one = createWorker();
      session = createSession(one);
   });

   /** Starts a call and watches how it settles, so that no rejection is left unhandled. */
   function track(promise: Promise<unknown>) {
      const state: { status: "pending" | "settled"; value?: any } = { status: "pending" };
      promise.then(
         (value) => {
            state.status = "settled";
            state.value = value;
         },
         (error) => {
            state.status = "settled";
            state.value = { thrown: error };
         },
      );
      return state;
   }

   const hangs = () => new Promise(() => undefined);

   it("answers with the plain IpcTimeoutError when the handler does not answer in time", async () => {
      vi.useFakeTimers();
      main.ipc.slowStatus.handle(session, hangs);
      const call = track(one.invoke("slowStatus"));

      await vi.advanceTimersByTimeAsync(799);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.value).toStrictEqual({
         ok: false,
         error: {
            name: "IpcTimeoutError",
            message: "The channel 'slowStatus' did not answer within 800 ms",
            code: "IPC_TIMEOUT",
         },
      });
   });

   it("applies the default of the config to a channel without the option", async () => {
      vi.useFakeTimers();
      main.ipc.plainStatus.handle(session, hangs);
      main.ipc.getToken.handle(session, hangs);
      const plain = track(one.invoke("plainStatus"));
      const validated = track(one.invoke("getToken", "app"));

      await vi.advanceTimersByTimeAsync(4999);
      expect(plain.status).toBe("pending");
      expect(validated.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      for (const call of [plain, validated]) {
         expect(call.value).toMatchObject({ ok: false, error: { code: "IPC_TIMEOUT" } });
      }
   });

   it("waits for ever on a channel whose timeout is 0, though the config has a default", async () => {
      vi.useFakeTimers();
      main.ipc.patientStatus.handle(session, hangs);
      const call = track(one.invoke("patientStatus", "app"));

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(call.status).toBe("pending");
   });

   it("answers with the value of a handler in time, and drops the timer", async () => {
      vi.useFakeTimers();
      main.ipc.slowStatus.handle(
         session,
         () => new Promise((resolve) => setTimeout(() => resolve("up"), 100)),
      );
      const call = track(one.invoke("slowStatus"));

      await vi.advanceTimersByTimeAsync(100);

      expect(call.value).toStrictEqual(ok("up"));
      expect(vi.getTimerCount()).toBe(0);
   });

   it("answers with the error of a handler that fails in time, and drops the timer", async () => {
      vi.useFakeTimers();
      main.ipc.slowStatus.handle(session, () => Promise.reject(new Error("failed")));
      const call = track(one.invoke("slowStatus"));

      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ ok: false, error: { name: "Error", message: "failed" } });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("sets no timer for a handler that answers at once", async () => {
      vi.useFakeTimers();
      main.ipc.slowStatus.handle(session, () => "up");

      expect(await one.invoke("slowStatus")).toStrictEqual(ok("up"));
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply of the handler after the timeout", async () => {
      vi.useFakeTimers();
      let answer: (value: string) => void = () => undefined;
      main.ipc.slowStatus.handle(
         session,
         () => new Promise<string>((resolve) => (answer = resolve)),
      );
      const call = track(one.invoke("slowStatus"));

      await vi.advanceTimersByTimeAsync(800);
      answer("late");
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ ok: false, error: { code: "IPC_TIMEOUT" } });
   });

   it("covers the time that the schema takes, since the call has begun", async () => {
      vi.useFakeTimers();
      const slow = schema(oneString, true);
      const loaded = loadGuardMain(project as E2EProject, {
         scopeArgs: schema(oneString),
         stateArgs: schema(oneNumber),
         slowArgs: slow,
      });
      const handler = vi.fn();
      loaded.ipc.slowEcho.handle(session, handler);
      const call = track(one.invoke("slowEcho", "x"));

      await vi.advanceTimersByTimeAsync(5000);

      expect(call.value).toMatchObject({ ok: false, error: { code: "IPC_TIMEOUT" } });
      // As for a handler, the work of a call that timed out is not stopped, and its reply is dropped.
      slow.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(call.value).toMatchObject({ ok: false, error: { code: "IPC_TIMEOUT" } });
   });

   it("lets a handler that throws at once reject without a timer", async () => {
      vi.useFakeTimers();
      main.ipc.slowStatus.handle(session, () => {
         throw new Error("sync failure");
      });

      expect(await one.invoke("slowStatus")).toMatchObject({
         ok: false,
         error: { message: "sync failure" },
      });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("does not time a message", () => {
      vi.useFakeTimers();
      main.ipc.reportState.on(session, vi.fn());

      one.sendFrom("reportState", 1);

      expect(vi.getTimerCount()).toBe(0);
   });
});
