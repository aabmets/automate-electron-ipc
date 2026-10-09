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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await

import {
   loadPageBindings,
   resetTimeoutFakes,
   track,
} from "@testutils/e2e/utility-timeout-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   resetTimeoutFakes();
   await project?.cleanup();
   project = undefined;
});

describe("timeouts of invokeUtility and streamUtility, in the page", () => {
   async function load() {
      project = await runFixture("utility-timeouts");
      return loadPageBindings(project.generated["preload.ts"]);
   }

   describe("streams", () => {
      it("cancels the stream in the child and fails the read when no chunk arrives in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const read = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(699);
         expect(read.status).toBe("pending");
         await vi.advanceTimersByTimeAsync(1);

         expect(read.status).toBe("rejected");
         expect(Object.getPrototypeOf(read.value)).toBe(Object.prototype);
         expect(read.value).toStrictEqual({
            name: "IpcUtilityError",
            message: `The channel 'slowRows' did not answer within 700 ms`,
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(port.posted("cancel")).toStrictEqual([
            { __ipc: "cancel", channel: wire("slowRows"), id },
         ]);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("drops the chunks that arrive after the timeout", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const first = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(700);
         port.deliver({ __ipc: "chunk", channel: wire("slowRows"), id, value: 1 });
         const second = track(stream.next());
         await vi.advanceTimersByTimeAsync(0);

         expect(first.status).toBe("rejected");
         expect(second).toMatchObject({ status: "resolved", value: { done: true } });
      });

      it("does not cut a stream short after its first chunk", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");
         const first = track(stream.next());
         const id = port.posted("stream")[0].id;

         await vi.advanceTimersByTimeAsync(300);
         port.deliver({ __ipc: "chunk", channel: wire("slowRows"), id, value: 1 });
         await vi.advanceTimersByTimeAsync(0);
         const second = track(stream.next());
         await vi.advanceTimersByTimeAsync(100_000);

         expect(first).toMatchObject({ status: "resolved", value: { done: false, value: 1 } });
         expect(second.status).toBe("pending");
         expect(port.posted("cancel")).toHaveLength(0);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("ends the wait when the stream ends or fails before the first chunk", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const ended = api.slowRows.stream("rows");
         const endedRead = track(ended.next());
         port.deliver({
            __ipc: "end",
            channel: wire("slowRows"),
            id: port.posted("stream")[0].id,
         });
         await vi.advanceTimersByTimeAsync(0);
         const failing = api.slowRows.stream("rows");
         const failedRead = track(failing.next());
         port.deliver({
            __ipc: "error",
            channel: wire("slowRows"),
            id: port.posted("stream")[1].id,
            error: { name: "Boom", message: "x" },
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(endedRead).toMatchObject({ status: "resolved", value: { done: true } });
         expect(failedRead.value).toMatchObject({ name: "Boom" });
         expect(vi.getTimerCount()).toBe(0);
         expect(port.posted("cancel")).toHaveLength(0);
      });

      it("clears the timer when the page cancels the stream", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowRows");
         const stream = api.slowRows.stream("rows");

         stream.cancel();
         await vi.advanceTimersByTimeAsync(10_000);

         expect(port.posted("cancel")).toHaveLength(1);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("counts the wait for the port, and does not start the stream afterwards", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const stream = api.slowRows.stream("rows");
         const read = track(stream.next());

         await vi.advanceTimersByTimeAsync(700);
         expect(read.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         const port = arrive("slowRows");

         expect(port.posted("stream")).toHaveLength(0);
      });

      it("clears the timer when the connection closes", async () => {
         vi.useFakeTimers();
         const { api, arrive, closeFromMain } = await load();
         arrive("slowRows", "k1");
         const read = track(api.slowRows.stream("rows").next());

         closeFromMain("slowRows", "k1");
         await vi.advanceTimersByTimeAsync(0);

         expect(read.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("has no timer for a stream without the option, though the config has a default", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         arrive("plainRows");
         const read = track(api.plainRows.stream().next());

         await vi.advanceTimersByTimeAsync(1_000_000);

         expect(read.status).toBe("pending");
      });
   });
});
