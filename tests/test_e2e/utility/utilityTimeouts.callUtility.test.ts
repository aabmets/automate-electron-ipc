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

import { createChild, setAttachChild } from "@testutils/e2e/fake-utility.js";
import { createFakeElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { resetTimeoutFakes, track } from "@testutils/e2e/utility-timeout-utils.js";
import { ok, wire } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   resetTimeoutFakes();
});

describe("fixture utility-timeouts", () => {
   it("generates files that type-check, including the timeout code", async () => {
      const project = await fixtures.run("utility-timeouts");
      expect(await project.typecheck()).toBe("");
   });

   it("adds the timeout to the calls of a channel that has one, and to none else", async () => {
      const project = await fixtures.run("utility-timeouts");
      const main = project.generated["main.ts"];
      const utility = project.generated["utility.ts"];
      const preload = project.generated["preload.ts"];

      expect(main).toMatch(/callUtilityChild\(child, 'autoipc:slowIndex'.*, 1000\)/);
      expect(main).toMatch(/'autoipc:defaultedIndex', \[path\], 5000\)/);
      expect(main).toMatch(/'autoipc:legacyIndex', \[\], 300\)/);
      expect(main).not.toMatch(/'autoipc:patientIndex'.*, \d+\)/);
      expect(utility).toMatch(/'autoipc:slowSetting', \[key\], 800\)/);
      expect(utility).toMatch(/'autoipc:defaultedSetting', \[key\], 5000\)/);
      expect(utility).not.toMatch(/'autoipc:patientSetting'.*, \d+\)/);
      expect(preload).toContain("callUtilityPort(utilityClients['slowQuery'], args, 1200)");
      expect(preload).toContain("callUtilityPort(utilityClients['defaultedQuery'], args, 5000)");
      expect(preload).toContain("callUtilityPort(utilityClients['patientQuery'], args)");
      // The default of the config does not time a stream.
      expect(preload).toContain("openUtilityStream(utilityClients['slowRows'], args, 1024, 700)");
      expect(preload).toMatch(/openUtilityStream\(utilityClients\['plainRows'\], args, \d+\)/);
   });

   it("declares the timeout code in window.d.ts", async () => {
      const project = await fixtures.run("utility-timeouts");
      expect(project.generated["types.ts"]).toContain("'IPC_UTILITY_TIMEOUT'");
   });

   it("does not write the timers into a project without a timeout", async () => {
      const project = await fixtures.run("utility-channels");
      expect(project.generated["main.ts"]).not.toMatch(/callUtilityPeer\([^)]*\), \d+\)/);
      expect(project.generated["utility.ts"]).not.toMatch(/callUtilityPeer\([^)]*\), \d+\)/);
   });
});

describe("timeouts of callUtility, in the main process", () => {
   async function load() {
      const project = await fixtures.run("utility-timeouts");
      const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
      setAttachChild(main.attachUtility);
      return main;
   }

   it("rejects with IPC_UTILITY_TIMEOUT when the child does not answer in time", async () => {
      vi.useFakeTimers();
      const { ipc, IpcUtilityError } = await load();
      const { child } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.status).toBe("rejected");
      expect(call.value).toBeInstanceOf(IpcUtilityError);
      expect(call.value).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_TIMEOUT",
         channel: wire("slowIndex"),
         message: `The channel '${wire("slowIndex")}' did not answer within 1000 ms`,
      });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("resolves, and clears the timer, when the child answers in time", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(500);
      reply("slowIndex", posted("call", "slowIndex")[0].id, ok(7));
      await vi.advanceTimersByTimeAsync(0);

      expect(call).toMatchObject({ status: "resolved", value: 7 });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("rejects with the error of the handler, and clears the timer, when it fails in time", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));

      reply("slowIndex", posted("call", "slowIndex")[0].id, {
         ok: false,
         error: { name: "RangeError", message: "out", code: "E_RANGE" },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect(call.value).toMatchObject({ name: "RangeError", code: "E_RANGE" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply after the timeout", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a.txt"));
      const id = posted("call", "slowIndex")[0].id;

      await vi.advanceTimersByTimeAsync(1000);
      reply("slowIndex", id, ok(7));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect(call.value.code).toBe("IPC_UTILITY_TIMEOUT");
   });

   it("uses the default of the config for a channel without the option", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.defaultedIndex.invoke(child, "a.txt"));

      await vi.advanceTimersByTimeAsync(4999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
      expect(call.value.message).toContain("within 5000 ms");
   });

   it("waits for ever on a channel with timeoutMs 0, though the config has a default", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.patientIndex.invoke(child));

      await vi.advanceTimersByTimeAsync(1_000_000);

      expect(call.status).toBe("pending");
      expect(vi.getTimerCount()).toBe(0);
   });

   it("applies the option of the alternative form", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.legacyIndex.invoke(child));

      await vi.advanceTimersByTimeAsync(300);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_TIMEOUT" });
   });

   it("times each call on its own", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child, posted, reply } = createChild();
      const first = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(600);
      const second = track(ipc.slowIndex.invoke(child, "b"));
      await vi.advanceTimersByTimeAsync(400);

      expect(first.status).toBe("rejected");
      expect(second.status).toBe("pending");
      reply("slowIndex", posted("call", "slowIndex")[1].id, ok(2));
      await vi.advanceTimersByTimeAsync(0);
      expect(second).toMatchObject({ status: "resolved", value: 2 });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("clears the timer when the child exits, which rejects the call with IPC_UTILITY_EXITED", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      const call = track(ipc.slowIndex.invoke(child, "a"));

      child.emit("exit", 1);
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("clears the timer, and rejects, for a message that cannot be posted", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("not cloneable");
      });
      const call = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_UNSENDABLE" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("does not start a timer for a call on a child that is gone", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();
      ipc.pause.send(child);
      child.emit("exit", 1);

      const call = track(ipc.slowIndex.invoke(child, "a"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toMatchObject({ code: "IPC_UTILITY_EXITED" });
      expect(vi.getTimerCount()).toBe(0);
   });

   it("does not time a notification, which has no reply", async () => {
      vi.useFakeTimers();
      const { ipc } = await load();
      const { child } = createChild();

      ipc.pause.send(child);

      expect(vi.getTimerCount()).toBe(0);
   });
});
