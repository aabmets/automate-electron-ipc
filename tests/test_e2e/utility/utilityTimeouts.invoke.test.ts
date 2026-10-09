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

import { ok, wire } from "@testutils/e2e/utility-process-utils.js";
import {
   loadPageBindings,
   resetTimeoutFakes,
   track,
} from "@testutils/e2e/utility-timeout-utils.js";
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

   describe("calls", () => {
      it("rejects with the plain object of IPC_UTILITY_TIMEOUT when the child does not answer in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(1199);
         expect(call.status).toBe("pending");
         await vi.advanceTimersByTimeAsync(1);

         expect(call.status).toBe("rejected");
         expect(Object.getPrototypeOf(call.value)).toBe(Object.prototype);
         expect(call.value).toStrictEqual({
            name: "IpcUtilityError",
            message: `The channel 'slowQuery' did not answer within 1200 ms`,
            code: "IPC_UTILITY_TIMEOUT",
         });
         expect(port.posted("call")).toHaveLength(1);
         expect(vi.getTimerCount()).toBe(0);
      });

      it("resolves, and clears the timer, when the child answers in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(600);
         port.deliver({
            __ipc: "reply",
            channel: wire("slowQuery"),
            id: port.posted("call")[0].id,
            envelope: ok("rows"),
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(call).toMatchObject({ status: "resolved", value: "rows" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("rejects with the error of the handler, and clears the timer, when it fails in time", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));

         port.deliver({
            __ipc: "reply",
            channel: wire("slowQuery"),
            id: port.posted("call")[0].id,
            envelope: { ok: false, error: { name: "QueryError", message: "bad", code: "E_Q" } },
         });
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ name: "QueryError", code: "E_Q" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("drops the late reply after the timeout", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         const call = track(api.slowQuery.invoke("select 1"));
         const id = port.posted("call")[0].id;

         await vi.advanceTimersByTimeAsync(1200);
         port.deliver({ __ipc: "reply", channel: wire("slowQuery"), id, envelope: ok("late") });
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
      });

      it("counts the wait for the port, and does not send the call afterwards", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const call = track(api.slowQuery.invoke("select 1"));

         await vi.advanceTimersByTimeAsync(1200);
         expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         const port = arrive("slowQuery");

         expect(port.posted("call")).toHaveLength(0);
      });

      it("clears the timer when the connection closes, which rejects with IPC_UTILITY_EXITED", async () => {
         vi.useFakeTimers();
         const { api, arrive, closeFromMain } = await load();
         arrive("slowQuery", "k1");
         const call = track(api.slowQuery.invoke("select 1"));

         closeFromMain("slowQuery", "k1");
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("clears the timer when the call cannot be posted", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         const port = arrive("slowQuery");
         port.postMessage.mockImplementation(() => {
            throw new Error("not cloneable");
         });
         const call = track(api.slowQuery.invoke("select 1"));
         await vi.advanceTimersByTimeAsync(0);

         expect(call.value).toMatchObject({ code: "IPC_UTILITY_UNSENDABLE" });
         expect(vi.getTimerCount()).toBe(0);
      });

      it("uses the default of the config, and none for timeoutMs 0", async () => {
         vi.useFakeTimers();
         const { api, arrive } = await load();
         arrive("defaultedQuery");
         arrive("patientQuery");
         const defaulted = track(api.defaultedQuery.invoke("select 1"));
         const patient = track(api.patientQuery.invoke());

         await vi.advanceTimersByTimeAsync(5000);

         expect(defaulted.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
         expect(defaulted.value.message).toContain("within 5000 ms");
         expect(patient.status).toBe("pending");
      });
   });
});
