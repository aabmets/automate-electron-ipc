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
import { failed, flush, ok, wire } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
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
});
