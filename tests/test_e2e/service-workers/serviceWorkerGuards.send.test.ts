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
import { flush } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.useRealTimers();
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

describe("fixture service-worker-guards", () => {
   it("type-checks the files of the page project and of the worker project", async () => {
      project = await runFixture("service-worker-guards");
      expect(await project.typecheck()).toBe("");
      expect(await project.typecheckWorker()).toBe("");
   }, 60_000);

   it("times the calls in the main process, since the preload script of a worker has no timers", async () => {
      project = await runFixture("service-worker-guards");
      const main = project.generated["main.ts"] as string;
      const preload = project.generated["service-worker-preload.ts"] as string;

      expect(main).toContain(
         "{ channel: 'getToken', wire: 'autoipc:getToken', validator: scopeArgs, timeoutMs: 5000 },",
      );
      expect(main).toContain(
         "{ channel: 'plainStatus', wire: 'autoipc:plainStatus', timeoutMs: 5000 },",
      );
      expect(main).toContain(
         "{ channel: 'slowStatus', wire: 'autoipc:slowStatus', timeoutMs: 800 },",
      );
      expect(main).toMatch(/channel: 'patientStatus'(?:(?!timeoutMs).)*\},/);
      expect(preload).not.toContain("withTimeout");
      expect(preload).not.toContain("setTimeout");
   });

   it("declares the timeout error for the worker, and validation only in the main process", async () => {
      project = await runFixture("service-worker-guards");

      expect(project.generated["service-worker.d.ts"]).toContain("type IpcTimeoutError =");
      expect(project.generated["service-worker-preload.ts"]).not.toContain("validate");
      expect(project.generated["main.ts"]).toContain("export class IpcValidationError");
      expect(project.generated["window.d.ts"]).not.toContain("getToken");
   });
});

describe("validation of the calls of a worker, in the main process", () => {
   let main: any;
   let fake: ReturnType<typeof createSession>;
   let one: ReturnType<typeof createWorker>;
   let session: any;
   const scopeArgs = schema(oneString);
   const stateArgs = schema(oneNumber);
   const slowArgs = schema(oneString, true);

   beforeEach(async () => {
      project = await runFixture("service-worker-guards");
      main = loadGuardMain(project, { __esModule: true, scopeArgs, stateArgs, slowArgs });
      one = createWorker();
      fake = createSession(one);
      session = fake;
      for (const each of [scopeArgs, stateArgs, slowArgs]) {
         each.validate.mockClear();
      }
   });

   describe("sendFromWorker", () => {
      it("calls the listener with the validated arguments", () => {
         const listener = vi.fn();
         main.ipc.reportState.on(session, listener);

         one.sendFrom("reportState", 3);

         expect(stateArgs.validate).toHaveBeenCalledWith([3]);
         expect(listener).toHaveBeenCalledWith(expect.objectContaining({ versionId: 1 }), 3);
      });

      it("drops an invalid message, and reports it to onRejected", () => {
         const listener = vi.fn();
         main.ipc.reportState.on(session, listener);
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         one.sendFrom("reportState", "three");

         expect(listener).not.toHaveBeenCalled();
         expect(onRejected).toHaveBeenCalledTimes(1);
         const [event, channel, error] = onRejected.mock.calls[0];
         expect(event).toMatchObject({ versionId: 1 });
         expect(channel).toBe("reportState");
         expect(error).toBeInstanceOf(main.IpcValidationError);
         expect(error.issues).toStrictEqual([{ message: "expected one number" }]);
      });

      it("throws nothing into the code of Electron for an invalid message or a hook that throws", () => {
         main.ipc.reportState.on(session, vi.fn());
         main.configureServiceWorkerIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });

         expect(() => one.sendFrom("reportState", "three")).not.toThrow();
      });

      it("does not validate while nobody listens", () => {
         main.attachServiceWorkers(session);
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         one.sendFrom("reportState", "three");

         expect(stateArgs.validate).not.toHaveBeenCalled();
         expect(onRejected).not.toHaveBeenCalled();
      });

      it("does not validate a channel without a validator", () => {
         const listener = vi.fn();
         main.ipc.plainReport.on(session, listener);

         one.sendFrom("plainReport", 1, 2, 3);

         expect(listener).toHaveBeenCalledWith(expect.anything(), 1, 2, 3);
      });

      it("calls every listener with the validated arguments, and goes on when one throws", () => {
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const first = vi.fn(() => {
            throw new Error("listener failed");
         });
         const second = vi.fn();
         main.ipc.reportState.on(session, first);
         main.ipc.reportState.on(session, second);

         one.sendFrom("reportState", 7);

         expect(second).toHaveBeenCalledWith(expect.anything(), 7);
         expect(error).toHaveBeenCalledTimes(1);
      });

      it("uses up a once listener with the first valid message, though the schema is slow", async () => {
         const listener = vi.fn();
         main.ipc.slowReport.once(session, listener);

         one.sendFrom("slowReport", "one");
         one.sendFrom("slowReport", "two");
         await flush();
         expect(listener).not.toHaveBeenCalled();
         slowArgs.release();
         await flush();

         expect(listener).toHaveBeenCalledTimes(1);
         expect(listener).toHaveBeenCalledWith(expect.anything(), "one");
      });

      it("drops a message of a rejected worker before validating it", () => {
         const stranger = createWorker(2, "app://other/");
         const listener = vi.fn();
         main.ipc.reportState.on(createSession(stranger), listener);
         main.configureServiceWorkerIpc({ validateSender: () => false });

         stranger.sendFrom("reportState", 3);

         expect(listener).not.toHaveBeenCalled();
         expect(stateArgs.validate).not.toHaveBeenCalled();
      });
   });
});
