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
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { createSession, createWorker, wire } from "@testutils/service-worker-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const ok = (value: unknown) => ({ ok: true, value });
const failed = (error: Record<string, unknown>) => ({ ok: false, error });
/** Lets the promises that are settled by a message run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function load(fixture = "service-worker-channels") {
   project = await runFixture(fixture);
   const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
   return main;
}

describe("service worker channels, files", () => {
   it("type-checks main.ts, the preload script of the worker and the code which uses them", async () => {
      project = await runFixture("service-worker-channels");
      expect(await project.typecheck()).toBe("");
      expect(await project.typecheckWorker()).toBe("");
   }, 60_000);

   it("writes the files of the worker next to the others, and leaves the page its own channels", async () => {
      project = await runFixture("service-worker-channels");
      const { generated } = project;
      expect(Object.keys(generated).sort()).toStrictEqual([
         "main.ts",
         "preload.ts",
         "service-worker-preload.ts",
         "service-worker.d.ts",
         "window.d.ts",
      ]);
      expect(windowIpcPaths(generated["window.d.ts"])).toStrictEqual(["getUser.invoke"]);
      expect(windowIpcPaths(generated["service-worker.d.ts"])).toStrictEqual([
         "configChanged.on",
         "configChanged.once",
         "describe.handle",
         "echo.invoke",
         "flushQueue.handle",
         "getToken.invoke",
         "goOffline.on",
         "goOffline.once",
         "log.send",
         "saveBlob.invoke",
         "syncDone.send",
      ]);
      expect(generated["preload.ts"]).not.toContain("getToken");
      expect(generated["service-worker.d.ts"]).not.toContain("getUser");
   });
});

describe("service worker channels, one verb alone", () => {
   // A schema with a single verb gets only the helpers that the verb uses, so nothing is left unused.
   it.each(["emitToWorker", "sendFromWorker", "askWorker", "invokeFromWorker"])(
      "type-checks the files of a schema with only %s, also with unused locals refused",
      async (verb) => {
         project = await runFixture(`service-worker-only-${verb}`);
         const strict = { noUnusedLocals: true, noUnusedParameters: true };
         expect(await project.typecheck(strict)).toBe("");
         expect(await project.typecheckWorker(strict)).toBe("");
         expect(Object.keys(project.generated)).toContain("service-worker-preload.ts");
      },
   );
});

describe("service worker channels, main process", () => {
   let main: any;
   let fake: ReturnType<typeof createSession>;

   beforeEach(async () => {
      main = await load();
      fake = createSession();
   }, 60_000);

   describe("attachServiceWorkers", () => {
      it("routes the workers that run already, and the ones that start later", () => {
         const early = createWorker(1);
         fake.add(early);
         main.attachServiceWorkers(fake.session);
         const late = createWorker(2);
         fake.start(late);

         for (const one of [early, late]) {
            expect([...one.handlers.keys()].sort()).toStrictEqual([
               wire("echo"),
               wire("getToken"),
               wire("saveBlob"),
            ]);
            expect([...one.listeners.keys()].sort()).toStrictEqual([
               wire("describe:reply"),
               wire("flushQueue:reply"),
               wire("log"),
               wire("syncDone"),
            ]);
         }
      });

      it("routes a worker once, however often its status changes", () => {
         main.attachServiceWorkers(fake.session);
         const one = createWorker(1);
         fake.start(one, "starting");
         fake.status(1, "running");
         fake.status(1, "running");

         expect(one.worker.ipc.handle).toHaveBeenCalledTimes(3);
         expect(one.worker.ipc.on).toHaveBeenCalledTimes(4);
      });

      it("listens to a session once", () => {
         main.attachServiceWorkers(fake.session);
         main.attachServiceWorkers(fake.session);
         main.ipc.syncDone.on(fake.session, () => undefined);

         expect(fake.serviceWorkers.listenerCount("running-status-changed")).toBe(1);
      });

      it("keeps the hubs of two sessions apart", async () => {
         const other = createSession();
         const first = createWorker(1);
         const second = createWorker(1);
         main.ipc.getToken.handle(fake.session, () => Promise.resolve("first"));
         main.ipc.getToken.handle(other.session, () => Promise.resolve("second"));
         fake.start(first);
         other.start(second);

         expect(await first.invoke("getToken")).toStrictEqual(ok("first"));
         expect(await second.invoke("getToken")).toStrictEqual(ok("second"));
      });

      it("ignores a worker that is stopping, and logs a lookup that fails", () => {
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         main.attachServiceWorkers(fake.session);
         fake.serviceWorkers.getWorkerFromVersionID.mockImplementation(() => undefined);
         expect(() => fake.status(5, "starting")).not.toThrowError();
         fake.serviceWorkers.getWorkerFromVersionID.mockImplementation(() => {
            throw new Error("lookup failed");
         });
         expect(() => fake.status(6, "running")).not.toThrowError();
         expect(error).toHaveBeenCalledOnce();
      });
   });

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

   describe("questions to a worker", () => {
      let one: ReturnType<typeof createWorker>;

      beforeEach(() => {
         one = createWorker(5);
         main.attachServiceWorkers(fake.session);
         fake.start(one);
      });

      it("sends the question with an ID and resolves with the value of the answer", async () => {
         const answer = main.ipc.flushQueue.invoke(one.worker, true);

         expect(one.worker.send).toHaveBeenCalledWith(wire("flushQueue"), one.lastId(), true);
         one.reply("flushQueue", one.lastId(), ok(7));

         expect(await answer).toBe(7);
      });

      it("keeps the worker alive until the question is settled", async () => {
         const answer = main.ipc.flushQueue.invoke(one.worker, true);
         expect(one.worker.startTask).toHaveBeenCalledOnce();
         expect(one.end).not.toHaveBeenCalled();

         one.reply("flushQueue", one.lastId(), ok(1));
         await answer;

         expect(one.end).toHaveBeenCalledOnce();
      });

      it("rejects with an IpcAskError that carries the error of the responder", async () => {
         const answer = main.ipc.flushQueue.invoke(one.worker, false);
         one.reply(
            "flushQueue",
            one.lastId(),
            failed({ name: "FlushError", message: "locked", code: "LOCKED", data: { n: 1 } }),
         );

         const error = await answer.catch((caught: Error) => caught);
         expect(error).toBeInstanceOf(Error);
         expect(error).toMatchObject({
            name: "FlushError",
            message: "locked",
            code: "LOCKED",
            data: { n: 1 },
            channel: "flushQueue",
         });
         expect(one.end).toHaveBeenCalledOnce();
      });

      it.each([
         ["a string", "nope"],
         ["null", null],
         ["no ok flag", { value: 1 }],
         ["a failure without an error", { ok: false }],
      ])("rejects an unreadable reply: %s", async (_name, envelope) => {
         const answer = main.ipc.flushQueue.invoke(one.worker, true);
         one.reply("flushQueue", one.lastId(), envelope);

         await expect(answer).rejects.toMatchObject({
            name: "IpcAskError",
            code: "IPC_ASK_INVALID_REPLY",
            message: "The service worker sent an unreadable reply",
         });
      });

      it("matches each answer to its question, however they are ordered", async () => {
         const first = main.ipc.flushQueue.invoke(one.worker, true);
         const firstId = one.lastId();
         const second = main.ipc.describe.invoke(one.worker);
         const secondId = one.lastId();
         expect(secondId).not.toBe(firstId);

         one.reply("describe", secondId, ok({ pending: 3 }));
         one.reply("flushQueue", firstId, ok(1));

         expect(await first).toBe(1);
         expect(await second).toStrictEqual({ pending: 3 });
      });

      it("ignores an answer with an unknown ID, a wrong channel or the wrong worker", async () => {
         const other = createWorker(6);
         fake.start(other);
         const answer = main.ipc.flushQueue.invoke(one.worker, true);
         const settled = vi.fn();
         answer.then(settled, settled);
         const id = one.lastId();

         one.reply("flushQueue", id + 100, ok("unknown"));
         one.reply("flushQueue", String(id), ok("string id"));
         one.reply("describe", id, ok("wrong channel"));
         other.reply("flushQueue", id, ok("wrong worker"));
         await flush();
         expect(settled).not.toHaveBeenCalled();

         one.reply("flushQueue", id, ok("right"));
         expect(await answer).toBe("right");
      });

      it("settles once: a second answer changes nothing", async () => {
         const answer = main.ipc.flushQueue.invoke(one.worker, true);
         const id = one.lastId();
         one.reply("flushQueue", id, ok(1));
         one.reply("flushQueue", id, ok(2));

         expect(await answer).toBe(1);
         expect(one.end).toHaveBeenCalledOnce();
      });

      describe("when the worker goes away", () => {
         it.each(["stopping", "stopped"])(
            "rejects with IPC_ASK_DESTROYED at %s",
            async (status) => {
               const answer = main.ipc.flushQueue.invoke(one.worker, true);
               fake.stop(one, status);

               await expect(answer).rejects.toMatchObject({
                  name: "IpcAskError",
                  code: "IPC_ASK_DESTROYED",
                  channel: "flushQueue",
               });
               expect(one.end).toHaveBeenCalledOnce();
            },
         );

         it("leaves the questions to other workers alone", async () => {
            const other = createWorker(6);
            fake.start(other);
            const mine = main.ipc.flushQueue.invoke(one.worker, true);
            const theirs = main.ipc.flushQueue.invoke(other.worker, true);
            fake.stop(one);

            await expect(mine).rejects.toMatchObject({ code: "IPC_ASK_DESTROYED" });
            other.reply("flushQueue", other.lastId(), ok(9));
            expect(await theirs).toBe(9);
         });

         it("rejects at once for a worker that is destroyed already", async () => {
            one.worker.destroyed = true;

            await expect(main.ipc.flushQueue.invoke(one.worker, true)).rejects.toMatchObject({
               code: "IPC_ASK_DESTROYED",
            });
            expect(one.worker.send).not.toHaveBeenCalled();
         });

         it("rejects with a destroyed worker whose properties throw", async () => {
            const gone = createWorker(8);
            fake.start(gone);
            gone.worker.isDestroyed = () => {
               throw new TypeError("Object has been destroyed");
            };

            await expect(main.ipc.flushQueue.invoke(gone.worker, true)).rejects.toMatchObject({
               code: "IPC_ASK_DESTROYED",
            });
         });

         it("rejects with the error of a send that fails, and ends the task", async () => {
            one.worker.send.mockImplementation(() => {
               throw new Error("cannot send");
            });

            await expect(main.ipc.flushQueue.invoke(one.worker, true)).rejects.toThrowError(
               "cannot send",
            );
            expect(one.end).toHaveBeenCalledOnce();
         });
      });

      describe("timeouts", () => {
         beforeEach(() => {
            vi.useFakeTimers();
         });
         afterEach(() => {
            vi.useRealTimers();
         });

         it("rejects with IPC_ASK_TIMEOUT when the worker does not answer in time", async () => {
            const answer = main.ipc.flushQueue.invokeWith(one.worker, { timeoutMs: 500 }, true);
            const caught = answer.catch((error: Error) => error);

            await vi.advanceTimersByTimeAsync(499);
            expect(one.end).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);

            expect(await caught).toMatchObject({
               name: "IpcAskError",
               code: "IPC_ASK_TIMEOUT",
               message: "The service worker did not answer the channel 'flushQueue' within 500 ms",
            });
            expect(one.end).toHaveBeenCalledOnce();
         });

         it("drops the timer when the answer comes in time, and a late answer changes nothing", async () => {
            const answer = main.ipc.flushQueue.invokeWith(one.worker, { timeoutMs: 500 }, true);
            one.reply("flushQueue", one.lastId(), ok("in time"));

            expect(await answer).toBe("in time");
            expect(vi.getTimerCount()).toBe(0);
         });

         it("waits for the answer with an infinite timeout", async () => {
            const answer = main.ipc.flushQueue.invokeWith(
               one.worker,
               { timeoutMs: Number.POSITIVE_INFINITY },
               true,
            );
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(60_000);
            one.reply("flushQueue", one.lastId(), ok("late"));

            expect(await answer).toBe("late");
         });

         it("times out at once with a timeout of 0, like a question to a renderer", async () => {
            const answer = main.ipc.flushQueue.invokeWith(one.worker, { timeoutMs: 0 }, true);
            const caught = answer.catch((error: Error) => error);
            await vi.advanceTimersByTimeAsync(0);

            expect(await caught).toMatchObject({ code: "IPC_ASK_TIMEOUT" });
         });

         it.each([-1, Number.NaN, "5"])("refuses the timeout %j", async (timeoutMs) => {
            await expect(
               main.ipc.flushQueue.invokeWith(one.worker, { timeoutMs }, true),
            ).rejects.toThrowError("timeoutMs must be a number which is not negative");
            expect(one.worker.send).not.toHaveBeenCalled();
         });
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

describe("service worker channels, with rawErrors", () => {
   it("leaves the result and the errors of the handler to Electron", async () => {
      project = await runFixture("service-worker-channels");
      const source = project.generated["main.ts"];
      expect(source).toContain("settleInvoke(");
      // The same schema with the config turned on has no envelope around the handler.
      const raw = await runFixture("service-worker-raw-errors");
      try {
         const main = loadGenerated(raw.generated["main.ts"], { electron: createFakeElectron() });
         const fake = createSession();
         const one = createWorker();
         let calls = 0;
         main.ipc.getToken.handle(fake.session, () => {
            calls += 1;
            if (calls > 1) {
               throw Object.assign(new Error("no token"), { code: "E_TOKEN" });
            }
            return "plain";
         });
         fake.start(one);

         expect(await one.invoke("getToken")).toBe("plain");
         // The error is Electron's, which keeps the message only, and not the envelope of the library.
         await expect(one.invoke("getToken")).rejects.toThrow(
            "Error invoking remote method 'autoipc:getToken': Error: no token",
         );
         expect(raw.generated["main.ts"]).not.toContain("settleInvoke");
         expect(raw.generated["service-worker-preload.ts"]).toContain(
            "invoke: (...args: any[]) => ipcRenderer.invoke('autoipc:getToken', ...args),",
         );
      } finally {
         await raw.cleanup();
      }
   });
});

describe("service worker channels, preload script", () => {
   async function loadPreload(fixture = "service-worker-channels") {
      project = await runFixture(fixture);
      const fakeElectron = createFakePreloadElectron();
      const ipcRenderer = fakeElectron.electron.ipcRenderer as Record<
         string,
         ReturnType<typeof vi.fn>
      >;
      const exports = loadGenerated(project.generated["service-worker-preload.ts"] as string, {
         electron: fakeElectron.electron,
      });
      /** The listener that the script registered with `ipcRenderer.on` for the wire name. */
      const listenerFor = (channel: string) =>
         ipcRenderer.on.mock.calls.find((call) => call[0] === wire(channel))?.[1] as (
            ...args: unknown[]
         ) => void;
      return { ...fakeElectron, exports, ipcRenderer, listenerFor };
   }

   it("exposes the API of the worker under the key of the config, in the main world", async () => {
      const { exposed, exports, electron } = await loadPreload();

      expect(Object.keys(exposed)).toStrictEqual(["ipc"]);
      expect(exposed.ipc).toStrictEqual(exports.api);
      expect(electron.contextBridge.exposeInIsolatedWorld).not.toHaveBeenCalled();
      expect(callablePaths(exposed.ipc)).toStrictEqual([
         "configChanged.on",
         "configChanged.once",
         "describe.handle",
         "echo.invoke",
         "flushQueue.handle",
         "getToken.invoke",
         "goOffline.on",
         "goOffline.once",
         "log.send",
         "saveBlob.invoke",
         "syncDone.send",
      ]);
   });

   it("calls the main process with ipcRenderer.invoke, and unwraps the envelope", async () => {
      const { exposed, ipcRenderer } = await loadPreload();
      ipcRenderer.invoke.mockResolvedValueOnce(ok({ value: "t", expires: 1 }));

      expect(await exposed.ipc.getToken.invoke("app", true)).toStrictEqual({
         value: "t",
         expires: 1,
      });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(wire("getToken"), "app", true);

      const error = { name: "NotSignedInError", message: "no", code: "NOT_SIGNED_IN" };
      ipcRenderer.invoke.mockResolvedValueOnce(failed(error));
      await expect(exposed.ipc.getToken.invoke("app")).rejects.toBe(error);
   });

   it("sends with ipcRenderer.send", async () => {
      const { exposed, ipcRenderer } = await loadPreload();

      exposed.ipc.syncDone.send({ pending: 1 });
      exposed.ipc.log.send("info", "text");

      expect(ipcRenderer.send.mock.calls).toStrictEqual([
         [wire("syncDone"), { pending: 1 }],
         [wire("log"), "info", "text"],
      ]);
   });

   it("subscribes to the messages of the main process, and returns a disposer for each listener", async () => {
      const { exposed, ipcRenderer } = await loadPreload();
      const callback = vi.fn();

      const off = exposed.ipc.configChanged.on(callback);
      const registered = ipcRenderer.on.mock.calls.filter(
         (call) => call[0] === wire("configChanged"),
      );
      expect(registered).toHaveLength(1);
      registered[0][1]({ sender: "ignored" }, "theme", 1);
      expect(callback).toHaveBeenCalledWith("theme", 1);

      off();
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
         wire("configChanged"),
         registered[0][1],
      );
      exposed.ipc.goOffline.once(callback);
      expect(ipcRenderer.once).toHaveBeenCalledWith(wire("goOffline"), expect.any(Function));
   });

   describe("the responders to the questions of the main process", () => {
      it("answers on the reply channel with the ID and the envelope", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         const responder = vi.fn(async (force: boolean) => (force ? 7 : 0));
         exposed.ipc.flushQueue.handle(responder);

         listenerFor("flushQueue")({}, 42, true);
         await flush();

         expect(responder).toHaveBeenCalledWith(true);
         expect(ipcRenderer.send).toHaveBeenCalledWith(wire("flushQueue:reply"), 42, ok(7));
      });

      it("answers with IPC_ASK_NO_HANDLER while there is no responder", async () => {
         const { ipcRenderer, listenerFor } = await loadPreload();

         listenerFor("describe")({}, 1);
         await flush();

         expect(ipcRenderer.send).toHaveBeenCalledWith(
            wire("describe:reply"),
            1,
            failed({
               name: "IpcAskError",
               message: "No handler is registered for the channel 'describe'",
               code: "IPC_ASK_NO_HANDLER",
            }),
         );
      });

      it("answers with the fields of an error that the responder throws", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         exposed.ipc.flushQueue.handle(() =>
            Promise.reject({
               name: "FlushError",
               message: "locked",
               code: "LOCKED",
               data: { n: 1 },
            }),
         );

         listenerFor("flushQueue")({}, 3, false);
         await flush();

         expect(ipcRenderer.send).toHaveBeenCalledWith(
            wire("flushQueue:reply"),
            3,
            failed({ name: "FlushError", message: "locked", code: "LOCKED", data: { n: 1 } }),
         );
      });

      it("replaces the responder with a new one, and removes only its own with a disposer", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         const first = exposed.ipc.flushQueue.handle(() => 1);
         const second = exposed.ipc.flushQueue.handle(() => 2);
         first();

         listenerFor("flushQueue")({}, 1, true);
         await flush();
         expect(ipcRenderer.send).toHaveBeenLastCalledWith(wire("flushQueue:reply"), 1, ok(2));

         second();
         listenerFor("flushQueue")({}, 2, true);
         await flush();
         expect(ipcRenderer.send.mock.lastCall?.[2].error.code).toBe("IPC_ASK_NO_HANDLER");
      });

      it("replaces an answer that cannot be sent with an error", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         exposed.ipc.flushQueue.handle(() => 1);
         ipcRenderer.send.mockImplementationOnce(() => {
            throw new Error("An object could not be cloned");
         });

         listenerFor("flushQueue")({}, 5, true);
         await flush();

         expect(ipcRenderer.send).toHaveBeenLastCalledWith(
            wire("flushQueue:reply"),
            5,
            failed({
               name: "IpcAskError",
               message:
                  "The answer of the channel 'flushQueue' cannot be sent: An object could not be cloned",
               code: "IPC_ASK_UNSENDABLE",
            }),
         );
      });
   });

   it("uses the channel prefix of the config on every wire name", async () => {
      project = await runFixture("service-worker-prefix");
      const source = project.generated["service-worker-preload.ts"] as string;
      expect(source).toContain("'worker/getToken'");
      expect(source).toContain("'worker/flushQueue:reply'");
      expect(source).not.toContain("autoipc:");
      const mainSource = project.generated["main.ts"];
      expect(mainSource).toContain("wire: 'worker/getToken'");
      expect(mainSource).toContain("wire: 'worker/flushQueue:reply'");
   });
});
