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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createSession,
   createWorker,
   failed,
   loadWorkerMain,
   ok,
   wire,
} from "@testutils/service-worker-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

describe("service worker channels, main process", () => {
   let main: any;
   let fake: ReturnType<typeof createSession>;

   beforeEach(async () => {
      project = await runFixture("service-worker-channels");
      main = loadWorkerMain(project);
      fake = createSession();
   }, 60_000);

   describe("sender checks", () => {
      it.each([
         ["app://main/", true],
         ["app://main/sub/path/", true],
         ["http://localhost:5173/", true],
         ["app://other/", false],
         ["https://localhost:5173/", false],
         ["app://main.evil.com/", false],
         ["not a url", false],
      ])("compares the origin of the scope %s with allowedOrigins: %s", async (scope, allowed) => {
         const one = createWorker(1, scope);
         main.ipc.saveBlob.handle(fake.session, () => 5);
         fake.start(one);

         const result = await one.invoke("saveBlob", "name");

         expect(result.ok).toBe(allowed);
         if (!allowed) {
            expect(result).toStrictEqual(
               failed({
                  name: "IpcWorkerError",
                  message: "The service worker is not allowed to use the channel 'saveBlob'",
                  code: "IPC_WORKER_FORBIDDEN",
               }),
            );
         }
      });

      it("does not call the handler of a rejected worker, and drops its messages", async () => {
         const one = createWorker(1, "app://other/");
         const handler = vi.fn();
         const listener = vi.fn();
         main.ipc.saveBlob.handle(fake.session, handler);
         main.ipc.log.on(fake.session, listener);
         fake.start(one);

         await one.invoke("saveBlob", "name");
         one.sendFrom("log", "info", "text");

         expect(handler).not.toHaveBeenCalled();
         expect(listener).not.toHaveBeenCalled();
      });

      it("lets the channels without allowedOrigins take every worker", async () => {
         const one = createWorker(1, "app://anything/");
         main.ipc.echo.handle(fake.session, () => "yes");
         fake.start(one);

         expect(await one.invoke("echo")).toStrictEqual(ok("yes"));
      });

      it("asks validateSender with the event and the channel, and honours the answer", async () => {
         const one = createWorker(9);
         main.ipc.echo.handle(fake.session, () => "yes");
         fake.start(one);
         const validateSender = vi.fn(() => false);
         main.configureServiceWorkerIpc({ validateSender });

         expect((await one.invoke("echo")).ok).toBe(false);
         expect(validateSender).toHaveBeenCalledOnce();
         const [event, channel] = validateSender.mock.calls[0] as unknown as [any, string];
         expect(event.versionId).toBe(9);
         expect(event.serviceWorker.scope).toBe("app://main/");
         expect(channel).toBe("echo");

         validateSender.mockReturnValue(true as never);
         expect(await one.invoke("echo")).toStrictEqual(ok("yes"));
      });

      it.each([undefined, 1, "true", null])(
         "accepts only true from validateSender, not %j",
         async (answer) => {
            const one = createWorker();
            main.ipc.echo.handle(fake.session, () => "yes");
            fake.start(one);
            main.configureServiceWorkerIpc({ validateSender: () => answer });

            expect((await one.invoke("echo")).ok).toBe(false);
         },
      );

      it("counts a validateSender that throws as a rejection", async () => {
         const one = createWorker();
         main.ipc.echo.handle(fake.session, () => "yes");
         fake.start(one);
         main.configureServiceWorkerIpc({
            validateSender: () => {
               throw new Error("validator failed");
            },
         });

         expect((await one.invoke("echo")).ok).toBe(false);
      });

      it("tells onRejected about each rejection, and survives a hook that throws", async () => {
         const one = createWorker(4, "app://other/");
         main.ipc.saveBlob.handle(fake.session, () => 5);
         main.ipc.log.on(fake.session, () => undefined);
         fake.start(one);
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         await one.invoke("saveBlob", "name");
         one.sendFrom("log", "info", "text");

         expect(onRejected.mock.calls.map((call) => call[1])).toStrictEqual(["saveBlob", "log"]);
         expect(onRejected.mock.calls[0][0]).toMatchObject({ versionId: 4 });

         main.configureServiceWorkerIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });
         expect((await one.invoke("saveBlob", "name")).ok).toBe(false);
      });

      it("does not call onRejected for an allowed call", async () => {
         const one = createWorker();
         main.ipc.saveBlob.handle(fake.session, () => 5);
         fake.start(one);
         const onRejected = vi.fn();
         main.configureServiceWorkerIpc({ onRejected });

         expect(await one.invoke("saveBlob", "name")).toStrictEqual(ok(5));
         expect(onRejected).not.toHaveBeenCalled();
      });

      it("replaces the whole config with each call of configureServiceWorkerIpc", async () => {
         const one = createWorker();
         main.ipc.echo.handle(fake.session, () => "yes");
         fake.start(one);
         main.configureServiceWorkerIpc({ validateSender: () => false });
         main.configureServiceWorkerIpc({});

         expect(await one.invoke("echo")).toStrictEqual(ok("yes"));
      });
   });

   describe("channels from the main process", () => {
      it("sends to one worker with the wire name and the arguments", () => {
         const one = createWorker();

         main.ipc.configChanged.send(one.worker, "theme", { dark: true });
         main.ipc.goOffline.send(one.worker);

         expect(one.worker.send.mock.calls).toStrictEqual([
            [wire("configChanged"), "theme", { dark: true }],
            [wire("goOffline")],
         ]);
      });

      it("throws for a worker that is gone", () => {
         const one = createWorker();
         one.worker.destroyed = true;

         expect(() => main.ipc.goOffline.send(one.worker)).toThrowError(
            "The service worker that the channel 'goOffline' was sent to is gone",
         );
         expect(one.worker.send).not.toHaveBeenCalled();
      });

      it("broadcasts to the running workers of the session, and skips destroyed ones", () => {
         const a = createWorker(1);
         const b = createWorker(2);
         const c = createWorker(3);
         c.worker.destroyed = true;
         for (const one of [a, b, c]) {
            fake.add(one);
         }

         main.ipc.configChanged.broadcast(fake.session, "lang", "et");

         expect(a.worker.send).toHaveBeenCalledWith(wire("configChanged"), "lang", "et");
         expect(b.worker.send).toHaveBeenCalledWith(wire("configChanged"), "lang", "et");
         expect(c.worker.send).not.toHaveBeenCalled();
      });

      it("reaches the other workers when one fails, and logs the failure", () => {
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const a = createWorker(1);
         const b = createWorker(2);
         a.worker.send.mockImplementation(() => {
            throw new Error("cannot send");
         });
         fake.add(a);
         fake.add(b);

         main.ipc.goOffline.broadcast(fake.session);

         expect(b.worker.send).toHaveBeenCalledOnce();
         expect(error).toHaveBeenCalledOnce();
      });
   });

   describe("questions to a worker that no hub knows", () => {
      it("rejects with IPC_ASK_NOT_ATTACHED", async () => {
         const stranger = createWorker(9);

         await expect(main.ipc.flushQueue.invoke(stranger.worker, true)).rejects.toMatchObject({
            name: "IpcAskError",
            code: "IPC_ASK_NOT_ATTACHED",
         });
         expect(stranger.worker.send).not.toHaveBeenCalled();
      });
   });
});
