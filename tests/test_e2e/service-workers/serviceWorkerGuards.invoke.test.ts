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
import { flush, ok } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.useRealTimers();
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
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

   describe("invokeFromWorker", () => {
      it("runs the handler with the validated arguments, and answers with the value", async () => {
         const handler = vi.fn((_event: unknown, scope: string) => `${scope}!`);
         main.ipc.getToken.handle(session, handler);

         expect(await one.invoke("getToken", "app")).toStrictEqual(ok("app!"));

         expect(scopeArgs.validate).toHaveBeenCalledWith(["app"]);
         expect(handler).toHaveBeenCalledWith(expect.objectContaining({ versionId: 1 }), "app");
      });

      it("hands the handler what the schema returned", async () => {
         const upper = schema(oneString);
         upper.validate.mockImplementationOnce((value: unknown) => ({
            value: (value as string[]).map((text) => text.toUpperCase()),
         }));
         const loaded = loadGuardMain(project as E2EProject, {
            scopeArgs: upper,
            stateArgs,
            slowArgs,
         });
         const handler = vi.fn((_event: unknown, scope: string) => scope);
         loaded.ipc.getToken.handle(session, handler);

         expect(await one.invoke("getToken", "app")).toStrictEqual(ok("APP"));
      });

      it("rejects an invalid call with the IpcValidationError as a plain object, and skips the handler", async () => {
         const handler = vi.fn();
         main.ipc.getToken.handle(session, handler);

         const result = await one.invoke("getToken", 5);

         expect(result).toStrictEqual({
            ok: false,
            error: {
               name: "IpcValidationError",
               message: "The arguments of the channel 'getToken' are invalid: expected one string",
               code: "IPC_VALIDATION",
               data: [{ message: "expected one string", path: undefined }],
            },
         });
         expect(handler).not.toHaveBeenCalled();
      });

      it("rejects a call with the wrong number of arguments", async () => {
         const handler = vi.fn();
         main.ipc.getToken.handle(session, handler);

         expect((await one.invoke("getToken")).ok).toBe(false);
         expect((await one.invoke("getToken", "a", "b")).ok).toBe(false);
         expect(handler).not.toHaveBeenCalled();
      });

      it("counts a schema that throws, or that answers with nothing, as a failure", async () => {
         const handler = vi.fn();
         main.ipc.getToken.handle(session, handler);

         scopeArgs.validate.mockImplementationOnce(() => {
            throw new Error("boom");
         });
         const thrown = await one.invoke("getToken", "app");
         scopeArgs.validate.mockImplementationOnce(() => undefined as never);
         const empty = await one.invoke("getToken", "app");

         for (const result of [thrown, empty]) {
            expect(result).toMatchObject({
               ok: false,
               error: {
                  code: "IPC_VALIDATION",
                  message: expect.stringContaining("could not be validated"),
               },
            });
         }
         expect(handler).not.toHaveBeenCalled();
      });

      it("reports an invalid call to onRejected with the event, the channel and the error", async () => {
         main.ipc.getToken.handle(session, vi.fn());
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         await one.invoke("getToken", 5);

         expect(onRejected).toHaveBeenCalledTimes(1);
         const [event, channel, error] = onRejected.mock.calls[0];
         expect(event).toMatchObject({ versionId: 1 });
         expect(channel).toBe("getToken");
         expect(error).toBeInstanceOf(main.IpcValidationError);
         expect(error).toMatchObject({ code: "IPC_VALIDATION", channel: "getToken" });
         expect(error.issues).toStrictEqual([{ message: "expected one string" }]);
      });

      it("survives an onRejected hook that throws", async () => {
         main.ipc.getToken.handle(session, vi.fn());
         main.configureServiceWorkerIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });

         expect(await one.invoke("getToken", 5)).toMatchObject({
            ok: false,
            error: { code: "IPC_VALIDATION" },
         });
      });

      it("does not call onRejected for a valid call", async () => {
         main.ipc.getToken.handle(session, () => "x");
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         await one.invoke("getToken", "app");

         expect(onRejected).not.toHaveBeenCalled();
      });

      it("checks the sender first: a forbidden worker is not validated, and the hook gets an IpcWorkerError", async () => {
         const stranger = createWorker(2, "app://other/");
         const strangers = createSession(stranger);
         main.ipc.patientStatus.handle(strangers, vi.fn());
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         const result = await stranger.invoke("patientStatus", 5);

         expect(result).toMatchObject({ ok: false, error: { code: "IPC_WORKER_FORBIDDEN" } });
         expect(scopeArgs.validate).not.toHaveBeenCalled();
         const [, channel, error] = onRejected.mock.calls[0];
         expect(channel).toBe("patientStatus");
         expect(error).toBeInstanceOf(main.IpcWorkerError);
         expect(error.code).toBe("IPC_WORKER_FORBIDDEN");
      });

      it("validates the call of an allowed worker together with its origin", async () => {
         main.ipc.patientStatus.handle(session, (_event: unknown, scope: string) => scope);

         expect(await one.invoke("patientStatus", "app")).toStrictEqual(ok("app"));
         expect((await one.invoke("patientStatus", 5)).ok).toBe(false);
      });

      it("answers IPC_WORKER_NO_HANDLER without validating while nothing is registered", async () => {
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });
         // The route exists once the session is attached.
         main.attachServiceWorkers(session);

         const result = await one.invoke("getToken", 5);

         expect(result).toMatchObject({ ok: false, error: { code: "IPC_WORKER_NO_HANDLER" } });
         expect(scopeArgs.validate).not.toHaveBeenCalled();
         expect(onRejected).not.toHaveBeenCalled();
      });

      it("does not validate a channel without a validator", async () => {
         main.ipc.slowStatus.handle(session, () => "up");
         main.ipc.plainStatus.handle(session, () => 1);

         expect(await one.invoke("slowStatus", "anything", 1)).toStrictEqual(ok("up"));
         expect(await one.invoke("plainStatus", { any: "thing" })).toStrictEqual(ok(1));
         expect(scopeArgs.validate).not.toHaveBeenCalled();
      });

      it("rejects the arguments of a slow schema when it answers, and runs the handler when it accepts", async () => {
         const handler = vi.fn((_event: unknown, value: string) => value);
         main.ipc.slowEcho.handle(session, handler);

         const accepted = one.invoke("slowEcho", "yes");
         const rejected = one.invoke("slowEcho", 5);
         await flush();
         expect(handler).not.toHaveBeenCalled();
         slowArgs.release();

         expect(await accepted).toStrictEqual(ok("yes"));
         expect(await rejected).toMatchObject({ ok: false, error: { code: "IPC_VALIDATION" } });
         expect(handler).toHaveBeenCalledTimes(1);
      });

      it("uses a handleOnce handler up with the first valid call, though the schema is slow", async () => {
         const handler = vi.fn((_event: unknown, value: string) => value);
         main.ipc.slowEcho.handleOnce(session, handler);

         const first = one.invoke("slowEcho", "one");
         const second = one.invoke("slowEcho", "two");
         await flush();
         slowArgs.release();

         const results = await Promise.all([first, second]);
         expect(results.filter((result) => result.ok)).toStrictEqual([ok("one")]);
         expect(results.find((result) => !result.ok)).toMatchObject({
            error: { code: "IPC_WORKER_NO_HANDLER" },
         });
         expect(handler).toHaveBeenCalledTimes(1);
      });

      it("does not use up handleOnce with an invalid call", async () => {
         const handler = vi.fn((_event: unknown, scope: string) => scope);
         main.ipc.getToken.handleOnce(session, handler);

         expect((await one.invoke("getToken", 5)).ok).toBe(false);
         expect(await one.invoke("getToken", "app")).toStrictEqual(ok("app"));
         expect((await one.invoke("getToken", "again")).ok).toBe(false);
         expect(handler).toHaveBeenCalledTimes(1);
      });
   });
});
