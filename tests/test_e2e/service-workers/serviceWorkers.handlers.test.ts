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
   loadWorkerMain,
} from "@testutils/e2e/service-worker-utils.js";
import { failed, ok } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

describe("service worker channels, main process", () => {
   let main: any;
   let fake: ReturnType<typeof createSession>;

   beforeEach(async () => {
      const project = await fixtures.run("service-worker-channels");
      main = loadWorkerMain(project);
      fake = createSession();
   }, 60_000);

   describe("handlers of the calls of a worker", () => {
      it("runs the handler with the event of the worker first, and answers with the envelope", async () => {
         const one = createWorker(7, "http://localhost:5173/");
         const handler = vi.fn(async (_event: unknown, scope: string, force?: boolean) => ({
            value: `${scope}:${force}`,
            expires: 1,
         }));
         main.ipc.getToken.handle(fake.session, handler);
         fake.start(one);

         expect(await one.invoke("getToken", "app", true)).toStrictEqual(
            ok({ value: "app:true", expires: 1 }),
         );
         expect(handler).toHaveBeenCalledOnce();
         const event = handler.mock.calls[0][0] as any;
         expect(event.type).toBe("service-worker");
         expect(event.versionId).toBe(7);
         expect(event.serviceWorker).toBe(one.worker);
         expect("senderFrame" in event).toBe(false);
         expect(handler.mock.calls[0].slice(1)).toStrictEqual(["app", true]);
      });

      it("answers a failure with the name, message, code and data of the error", async () => {
         const one = createWorker();
         main.ipc.getToken.handle(fake.session, () => {
            throw Object.assign(new Error("not signed in"), {
               name: "NotSignedInError",
               code: "NOT_SIGNED_IN",
               data: { retry: false },
            });
         });
         fake.start(one);

         expect(await one.invoke("getToken", "app")).toStrictEqual(
            failed({
               name: "NotSignedInError",
               message: "not signed in",
               code: "NOT_SIGNED_IN",
               data: { retry: false },
            }),
         );
      });

      it("answers with IPC_WORKER_NO_HANDLER while nothing is registered", async () => {
         const one = createWorker();
         main.attachServiceWorkers(fake.session);
         fake.start(one);

         expect(await one.invoke("echo", 1)).toStrictEqual(
            failed({
               name: "IpcWorkerError",
               message: "No handler is registered for the channel 'echo'",
               code: "IPC_WORKER_NO_HANDLER",
            }),
         );
      });

      it("finds a handler that was registered after the worker started", async () => {
         const one = createWorker();
         main.attachServiceWorkers(fake.session);
         fake.start(one);
         main.ipc.echo.handle(fake.session, (_event: unknown, value: unknown) => value);

         expect(await one.invoke("echo", "late")).toStrictEqual(ok("late"));
      });

      it("keeps one handler per channel: a new one replaces the old one, and a disposer removes only its own", async () => {
         const one = createWorker();
         fake.start(one);
         const first = main.ipc.echo.handle(fake.session, () => "first");
         const second = main.ipc.echo.handle(fake.session, () => "second");

         expect(await one.invoke("echo")).toStrictEqual(ok("second"));
         first();
         expect(await one.invoke("echo")).toStrictEqual(ok("second"));
         second();
         expect((await one.invoke("echo")).ok).toBe(false);
         second();
      });

      it("uses up handleOnce with the first call", async () => {
         const one = createWorker();
         fake.start(one);
         main.ipc.echo.handleOnce(fake.session, (_event: unknown, value: unknown) => value);

         expect(await one.invoke("echo", 1)).toStrictEqual(ok(1));
         expect((await one.invoke("echo", 2)).ok).toBe(false);
      });

      it("lets handleOnce be removed before it is used", async () => {
         const one = createWorker();
         fake.start(one);
         const off = main.ipc.echo.handleOnce(fake.session, () => "once");
         off();

         expect((await one.invoke("echo")).ok).toBe(false);
      });

      it("serves every worker of the session with the same handler", async () => {
         const a = createWorker(1);
         const b = createWorker(2, "app://main/other/");
         main.ipc.echo.handle(fake.session, (event: any, value: number) => value + event.versionId);
         fake.start(a);
         fake.start(b);

         expect(await a.invoke("echo", 10)).toStrictEqual(ok(11));
         expect(await b.invoke("echo", 10)).toStrictEqual(ok(12));
      });
   });

   describe("listeners of the messages of a worker", () => {
      it("calls every listener with the event of the worker and the arguments", () => {
         const one = createWorker(3);
         const first = vi.fn();
         const second = vi.fn();
         main.ipc.syncDone.on(fake.session, first);
         main.ipc.syncDone.on(fake.session, second);
         fake.start(one);

         one.sendFrom("syncDone", { pending: 2 });

         for (const listener of [first, second]) {
            expect(listener).toHaveBeenCalledOnce();
            expect(listener.mock.calls[0][0]).toMatchObject({
               type: "service-worker",
               versionId: 3,
            });
            expect(listener.mock.calls[0][1]).toStrictEqual({ pending: 2 });
         }
      });

      it("removes a listener with its own disposer only", () => {
         const one = createWorker();
         fake.start(one);
         const first = vi.fn();
         const second = vi.fn();
         const off = main.ipc.syncDone.on(fake.session, first);
         main.ipc.syncDone.on(fake.session, second);
         off();
         off();

         one.sendFrom("syncDone", { pending: 1 });

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledOnce();
      });

      it("uses up a once listener with the first message, also with two in a row", () => {
         const one = createWorker();
         fake.start(one);
         const listener = vi.fn();
         main.ipc.syncDone.once(fake.session, listener);

         one.sendFrom("syncDone", { pending: 1 });
         one.sendFrom("syncDone", { pending: 2 });

         expect(listener).toHaveBeenCalledOnce();
         expect(listener.mock.calls[0][1]).toStrictEqual({ pending: 1 });
      });

      it("goes on with the other listeners when one throws", () => {
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const one = createWorker();
         fake.start(one);
         const after = vi.fn();
         main.ipc.syncDone.on(fake.session, () => {
            throw new Error("listener failed");
         });
         main.ipc.syncDone.on(fake.session, after);

         expect(() => one.sendFrom("syncDone", { pending: 1 })).not.toThrowError();

         expect(error).toHaveBeenCalledOnce();
         expect(after).toHaveBeenCalledOnce();
      });

      it("drops a message when nobody listens", () => {
         const one = createWorker();
         main.attachServiceWorkers(fake.session);
         fake.start(one);

         expect(() => one.sendFrom("syncDone", { pending: 1 })).not.toThrowError();
      });
   });
});
