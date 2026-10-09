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

import { loadGenerated } from "@testutils/e2e/runtime-utils.js";
import {
   createParentPort,
   resetTimeoutFakes,
   track,
} from "@testutils/e2e/utility-timeout-utils.js";
import { ok, wire } from "@testutils/e2e/wire-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   resetTimeoutFakes();
   await project?.cleanup();
   project = undefined;
});

describe("timeouts of callMain, in the utility process", () => {
   async function load() {
      project = await runFixture("utility-timeouts");
      const parent = createParentPort();
      const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});
      return { ...parent, ipc: utility.ipc, IpcUtilityError: utility.IpcUtilityError };
   }

   it("rejects with IPC_UTILITY_TIMEOUT when the main process does not answer in time", async () => {
      vi.useFakeTimers();
      const { ipc, IpcUtilityError } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));

      await vi.advanceTimersByTimeAsync(799);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.value).toBeInstanceOf(IpcUtilityError);
      expect(call.value).toMatchObject({
         code: "IPC_UTILITY_TIMEOUT",
         channel: wire("slowSetting"),
         message: `The channel '${wire("slowSetting")}' did not answer within 800 ms`,
      });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("resolves, clears the timer and drops nothing when the main process answers in time", async () => {
      vi.useFakeTimers();
      const { ipc, posted, reply } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));

      reply("slowSetting", posted("slowSetting")[0].id, ok("dark"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toMatchObject({ status: "resolved", value: "dark" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply after the timeout", async () => {
      vi.useFakeTimers();
      const { ipc, posted, reply } = await load();
      const call = track(ipc.slowSetting.invoke("theme"));
      const id = posted("slowSetting")[0].id;

      await vi.advanceTimersByTimeAsync(800);
      reply("slowSetting", id, ok("dark"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
   });

   it("uses the default of the config, and none for timeoutMs 0", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const defaulted = track(ipc.defaultedSetting.invoke("theme"));
      const patient = track(ipc.patientSetting.invoke());

      await vi.advanceTimersByTimeAsync(5000);

      expect(defaulted.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
      expect(patient.status).toBe("pending");
      expect(vi.getTimerCount()).toBe(0);
   });
});
