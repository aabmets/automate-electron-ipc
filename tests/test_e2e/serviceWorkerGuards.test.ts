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

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { createFakeElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.useRealTimers();
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const wire = (name: string) => `autoipc:${name}`;
const ok = (value: unknown) => ({ ok: true, value });
/** Lets the promises that are settled by a message run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Check = (args: unknown[]) => string | null;

/** A Standard Schema of an argument tuple, whose answer the test can hold back. */
function schema(check: Check, held = false) {
   const waiting: (() => void)[] = [];
   const validate = vi.fn((value: unknown) => {
      const message = Array.isArray(value) ? check(value) : "not an array";
      const result = message === null ? { value } : { issues: [{ message }] };
      return held ? new Promise((resolve) => waiting.push(() => resolve(result))) : result;
   });
   return {
      "~standard": { version: 1, vendor: "test", validate },
      validate,
      /** Answers the validations that are held back. */
      release: () => {
         for (const answer of waiting.splice(0)) {
            answer();
         }
      },
   };
}

const oneString: Check = (args) =>
   args.length === 1 && typeof args[0] === "string" ? null : "expected one string";
const oneNumber: Check = (args) =>
   args.length === 1 && typeof args[0] === "number" ? null : "expected one number";

/** A `ServiceWorkerMain` stand-in with the `ipc` of a worker, which records what is registered. */
function createWorker(versionId = 1, scope = "app://main/") {
   const handlers = new Map<string, (...args: any[]) => unknown>();
   const listeners = new Map<string, ((...args: any[]) => unknown)[]>();
   const worker = {
      versionId,
      scope,
      scriptURL: `${scope}sw.js`,
      isDestroyed: () => false,
      send: vi.fn(),
      startTask: vi.fn(() => ({ end: vi.fn() })),
      ipc: {
         handle: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
            handlers.set(channel, listener);
         }),
         on: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
            listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
         }),
      },
   };
   const event = () => ({ type: "service-worker", versionId, serviceWorker: worker });
   return {
      worker,
      /** The worker calls a channel of the main process like `ipcRenderer.invoke` does. */
      invoke: (channel: string, ...args: unknown[]) =>
         Promise.resolve(handlers.get(wire(channel))?.(event(), ...args)),
      /** The worker sends to a channel of the main process like `ipcRenderer.send` does. */
      sendFrom: (channel: string, ...args: unknown[]) => {
         for (const listener of listeners.get(wire(channel)) ?? []) {
            listener(event(), ...args);
         }
      },
   };
}

/** A `Session` stand-in with one worker that runs already. */
function createSession(...workers: ReturnType<typeof createWorker>[]) {
   const known = new Map(workers.map((fake) => [fake.worker.versionId, fake]));
   const serviceWorkers = Object.assign(new EventEmitter(), {
      getAllRunning: vi.fn(() => Object.fromEntries([...known.keys()].map((id) => [id, {}]))),
      getWorkerFromVersionID: vi.fn((id: number) => known.get(id)?.worker),
   });
   return { serviceWorkers };
}

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
      main = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
         "./validators": { __esModule: true, scopeArgs, stateArgs, slowArgs },
      });
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
         const loaded = loadGenerated(project?.generated["main.ts"] as string, {
            electron: createFakeElectron(),
            "./validators": { scopeArgs: upper, stateArgs, slowArgs },
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

describe("timeouts of the calls of a worker, in the main process", () => {
   let main: any;
   let one: ReturnType<typeof createWorker>;
   let session: any;

   beforeEach(async () => {
      project = await runFixture("service-worker-guards");
      main = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
         "./validators": {
            __esModule: true,
            scopeArgs: schema(oneString),
            stateArgs: schema(oneNumber),
            slowArgs: schema(oneString),
         },
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
      const loaded = loadGenerated(project?.generated["main.ts"] as string, {
         electron: createFakeElectron(),
         "./validators": {
            scopeArgs: schema(oneString),
            stateArgs: schema(oneNumber),
            slowArgs: slow,
         },
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
