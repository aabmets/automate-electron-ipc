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
   createChild,
   createParentPort,
   resetUtilityProcessFakes,
   setAttachChild,
} from "@testutils/e2e/fake-utility.js";
import { createSession, createWorker } from "@testutils/e2e/service-worker-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(resetUtilityProcessFakes);

describe("the fake utility process", () => {
   it("is attached to the bindings when it is made, unless it is told not to be", () => {
      const attach = vi.fn();
      setAttachChild(attach);

      const { child } = createChild();
      createChild({ attached: false });

      expect(attach.mock.calls).toStrictEqual([[child]]);
   });

   it("lists what the main process posted by tag and channel, and takes messages and replies", () => {
      const { child, posted, emitFromChild, reply } = createChild();
      const received = vi.fn();
      child.on("message", received);
      child.postMessage({ __ipc: "call", channel: wire("a"), id: 1 });
      child.postMessage({ __ipc: "call", channel: wire("b"), id: 2 });
      child.postMessage({ __ipc: "send", channel: wire("a") });

      emitFromChild({ __ipc: "send", channel: wire("a") });
      reply("a", 1, { ok: true, value: 3 });

      expect(posted("call").map((m) => m.id)).toStrictEqual([1, 2]);
      expect(posted("call", "b").map((m) => m.id)).toStrictEqual([2]);
      expect(received).toHaveBeenLastCalledWith({
         __ipc: "reply",
         channel: wire("a"),
         id: 1,
         envelope: { ok: true, value: 3 },
      });
   });

   it("stops being attached, and loses its parent port, when the fakes are reset", () => {
      const attach = vi.fn();
      setAttachChild(attach);
      const { port } = createParentPort();
      expect((process as unknown as { parentPort: unknown }).parentPort).toBe(port);

      resetUtilityProcessFakes();
      createChild();

      expect(attach).not.toHaveBeenCalled();
      expect((process as unknown as { parentPort?: unknown }).parentPort).toBeUndefined();
   });
});

describe("the fake parent port", () => {
   it("gives the child the messages of the main process as { data, ports }", () => {
      const { port, emitFromMain, broker } = createParentPort();
      const received = vi.fn();
      port.on("message", received);

      emitFromMain({ __ipc: "send" });
      const brokered = broker("pipe", "9:utility");

      expect(received).toHaveBeenNthCalledWith(1, { data: { __ipc: "send" }, ports: [] });
      expect(received).toHaveBeenNthCalledWith(2, {
         data: { __ipc: "port", channel: wire("pipe"), key: "9:utility" },
         ports: [brokered],
      });
   });
});

describe("the fake service worker", () => {
   it("rejects a call without a handler, and wraps what a handler throws, like Electron", async () => {
      const one = createWorker();
      one.worker.ipc.handle(wire("fails"), () => {
         throw new Error("boom");
      });

      await expect(one.invoke("missing")).rejects.toThrowError(
         `Error invoking remote method '${wire("missing")}': Error: No handler registered`,
      );
      await expect(one.invoke("fails")).rejects.toThrowError(
         `Error invoking remote method '${wire("fails")}': Error: boom`,
      );
   });

   it("refuses a second handler for one channel, like Electron", () => {
      const one = createWorker();
      one.worker.ipc.handle(wire("once"), () => 1);

      expect(() => one.worker.ipc.handle(wire("once"), () => 2)).toThrowError(/second handler for/);
   });

   it("knows the workers that run already when the session is made", () => {
      const one = createWorker(4);

      const { serviceWorkers } = createSession(one);

      expect(serviceWorkers.getWorkerFromVersionID(4)).toBe(one.worker);
      expect(Object.keys(serviceWorkers.getAllRunning())).toStrictEqual(["4"]);
   });
});
