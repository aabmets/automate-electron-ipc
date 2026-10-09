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

import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.useRealTimers();
});

/** Loads the generated preload script, with an `ipcRenderer.invoke` that the test answers itself. */
async function loadPreload() {
   const project = await fixtures.run("invoke-timeouts");
   const { electron, exposed } = createFakePreloadElectron();
   const replies = new Map<
      string,
      { resolve: (value: unknown) => void; reject: (e: unknown) => void }
   >();
   electron.ipcRenderer.invoke.mockImplementation(
      (wire: string) =>
         new Promise((resolve, reject) => {
            replies.set(wire, { resolve, reject });
         }),
   );
   loadGenerated(project.generated["preload.ts"], { electron });
   return { ipc: exposed.ipc, replies, ipcRenderer: electron.ipcRenderer };
}

/** Starts a call and watches how it settles, so that no rejection is left unhandled. */
function track(promise: Promise<unknown>) {
   const state: { status: "pending" | "resolved" | "rejected"; value?: unknown } = {
      status: "pending",
   };
   promise.then(
      (value) => {
         state.status = "resolved";
         state.value = value;
      },
      (error) => {
         state.status = "rejected";
         state.value = error;
      },
   );
   return state;
}

describe("fixture invoke-timeouts", () => {
   it("generates files that type-check, including the timeout error", async () => {
      const project = await fixtures.run("invoke-timeouts");

      expect(await project.typecheck()).toBe("");
   });

   it("documents the timeout error in window.d.ts", async () => {
      const project = await fixtures.run("invoke-timeouts");
      const types = project.generated["window.d.ts"];

      expect(types).toContain("/** @throws {IpcError<NotFoundError | IpcTimeoutError>} */");
      expect(types).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
      expect(types).toContain("type IpcTimeoutError = Error & {");
      // The channel with `timeoutMs: 0` waits for ever, and so documents no timeout.
      expect(types).toContain("patient: {\n      /** @throws {IpcError} */");
   });

   it("fails the type-check when the timeout error is used wrongly", async () => {
      const project = await fixtures.run("invoke-timeouts");
      const fsp = await import("node:fs/promises");
      const path = await import("node:path");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace('"IPC_TIMEOUT" = caught', '"IPC_OTHER" = caught'));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });
});

describe("generated timeouts of the preload script", () => {
   it("rejects with the timeout error when the handler does not answer in time", async () => {
      vi.useFakeTimers();
      const { ipc } = await loadPreload();
      const call = track(ipc.slow.invoke(1));

      await vi.advanceTimersByTimeAsync(999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.status).toBe("rejected");
      expect(call.value).toStrictEqual({
         name: "IpcTimeoutError",
         message: "The channel 'slow' did not answer within 1000 ms",
         code: "IPC_TIMEOUT",
      });
   });

   it("resolves with the value, and clears the timer, when the reply is in time", async () => {
      vi.useFakeTimers();
      const { ipc, replies } = await loadPreload();
      const call = track(ipc.slow.invoke(1));

      await vi.advanceTimersByTimeAsync(500);
      replies.get("autoipc:slow")?.resolve({ ok: true, value: "ada" });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("resolved");
      expect(call.value).toBe("ada");
      expect(vi.getTimerCount()).toBe(0);
   });

   it("rejects with the error of the handler, and clears the timer, when it fails in time", async () => {
      vi.useFakeTimers();
      const { ipc, replies } = await loadPreload();
      const call = track(ipc.slow.invoke(1));

      const error = { name: "NotFoundError", message: "no user", code: "NOT_FOUND" };
      replies.get("autoipc:slow")?.resolve({ ok: false, error });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect(call.value).toStrictEqual(error);
      expect(vi.getTimerCount()).toBe(0);
   });

   it("rejects with the error of the transport, and clears the timer", async () => {
      vi.useFakeTimers();
      const { ipc, replies } = await loadPreload();
      const call = track(ipc.slow.invoke(1));

      replies.get("autoipc:slow")?.reject(new Error("No handler registered"));
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect((call.value as Error).message).toBe("No handler registered");
      expect(vi.getTimerCount()).toBe(0);
   });

   it("drops the late reply after the timeout, and does not resolve the call again", async () => {
      vi.useFakeTimers();
      const { ipc, replies } = await loadPreload();
      const call = track(ipc.slow.invoke(1));

      await vi.advanceTimersByTimeAsync(1000);
      replies.get("autoipc:slow")?.resolve({ ok: true, value: "late" });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.status).toBe("rejected");
      expect((call.value as { code: string }).code).toBe("IPC_TIMEOUT");
   });

   it("uses the default of the config for a channel without the option", async () => {
      vi.useFakeTimers();
      const { ipc } = await loadPreload();
      const call = track(ipc.defaulted.invoke());

      await vi.advanceTimersByTimeAsync(1999);
      expect(call.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);

      expect(call.status).toBe("rejected");
      expect((call.value as { message: string }).message).toBe(
         "The channel 'defaulted' did not answer within 2000 ms",
      );
   });

   it("waits for ever on a channel with timeoutMs 0, also though the config has a default", async () => {
      vi.useFakeTimers();
      const { ipc, replies } = await loadPreload();
      const call = track(ipc.patient.invoke());

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(call.status).toBe("pending");
      replies.get("autoipc:patient")?.resolve({ ok: true, value: "done" });
      await vi.advanceTimersByTimeAsync(0);

      expect(call.value).toBe("done");
   });

   it("times each call on its own", async () => {
      vi.useFakeTimers();
      const { ipc, ipcRenderer } = await loadPreload();
      const first = track(ipc.slow.invoke(1));
      await vi.advanceTimersByTimeAsync(600);
      const second = track(ipc.slow.invoke(2));
      await vi.advanceTimersByTimeAsync(400);

      expect(first.status).toBe("rejected");
      expect(second.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(600);
      expect(second.status).toBe("rejected");
      expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
   });

   it("applies the option of the alternative form", async () => {
      vi.useFakeTimers();
      const { ipc } = await loadPreload();
      const call = track(ipc.legacy.invoke());

      await vi.advanceTimersByTimeAsync(300);

      expect(call.status).toBe("rejected");
      expect((call.value as { code: string }).code).toBe("IPC_TIMEOUT");
   });

   it("does not time a send, which has no reply", async () => {
      vi.useFakeTimers();
      const { ipc, ipcRenderer } = await loadPreload();

      ipc.ping.send();

      expect(ipcRenderer.send).toHaveBeenCalledWith("autoipc:ping");
      expect(vi.getTimerCount()).toBe(0);
   });
});
