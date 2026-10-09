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

import { cleanupRuntime, generateFixture } from "@testutils/runtime-main-utils.js";
import {
   callCount,
   fail,
   inApp,
   isNumber,
   loadValidated,
   ok,
} from "@testutils/runtime-validation-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupRuntime);

describe("generated main process bindings", () => {
   describe("argument validation", () => {
      it("checks the sender before the schema sees the arguments", async () => {
         const { generated, handlers, ipc, id } = await loadValidated();
         ipc.getSecret.handle(vi.fn());

         await expect(
            handlers.get("getSecret")?.({ senderFrame: { origin: "https://evil" } }, 1),
         ).rejects.toMatchObject({ name: "IpcForbiddenError" });
         expect(generated.IpcForbiddenError).toBeTypeOf("function");
         expect(id.validate).not.toHaveBeenCalled();
         await expect(handlers.get("getSecret")?.(inApp, "bad")).rejects.toMatchObject({
            name: "IpcValidationError",
         });
      });

      it("reports each rejection to onRejected, with the reason, and never an accepted call", async () => {
         const { generated, handlers, emitter, ipc } = await loadValidated({
            line: () => fail("no good"),
         });
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getCount.handle(vi.fn());
         ipc.logLine.on(vi.fn());

         await callCount(handlers, 1);
         expect(onRejected).not.toHaveBeenCalled();
         await expect(callCount(handlers, "bad")).rejects.toThrowError();
         emitter.emit("logLine", { id: "evt" }, "x");

         expect(onRejected).toHaveBeenCalledTimes(2);
         const [event, channel, error] = onRejected.mock.calls[1];
         expect(event).toStrictEqual({ id: "evt" });
         // Hooks get the name from the schema, not the name on the wire.
         expect(channel).toBe("logLine");
         expect(error).toBeInstanceOf(generated.IpcValidationError);
         expect(error.issues).toStrictEqual([{ message: "no good" }]);
         expect(onRejected.mock.calls[0][2]).toBeInstanceOf(generated.IpcValidationError);
      });

      it("passes an IpcForbiddenError to onRejected when the sender is refused", async () => {
         const { generated, handlers, ipc } = await loadValidated();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getSecret.handle(vi.fn());

         await expect(handlers.get("getSecret")?.({ senderFrame: null }, 1)).rejects.toThrowError();

         expect(onRejected.mock.calls[0][2]).toBeInstanceOf(generated.IpcForbiddenError);
      });

      it("rejects as usual when onRejected throws", async () => {
         const { generated, handlers, emitter, ipc } = await loadValidated({
            line: () => fail("x"),
         });
         generated.configureIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);
         ipc.logLine.on(callback);

         await expect(callCount(handlers, "bad")).rejects.toMatchObject({
            name: "IpcValidationError",
         });
         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(() => emitter.emit("logLine", {}, "x")).not.toThrow();
         expect(callback).not.toHaveBeenCalled();
      });

      it("does not validate channels without a validator", async () => {
         const { handlers, ipc, id, line, none } = await loadValidated();
         ipc.getPublic.handle(async () => 7);

         await expect(handlers.get("getPublic")?.({}, "anything")).resolves.toBe(7);
         for (const validator of [id, line, none]) {
            expect(validator.validate).not.toHaveBeenCalled();
         }
      });

      it("does not use up once or handleOnce with an invalid message", async () => {
         const { emitter, handlers, ipc } = await loadValidated({
            id: isNumber,
            line: (value) => (typeof (value as unknown[])[0] === "string" ? ok(value) : fail("x")),
         });
         const answer = vi.fn(() => "done");
         const heard = vi.fn();
         ipc.getCount.handleOnce(answer);
         ipc.logLine.once(heard);

         await expect(callCount(handlers, "bad")).rejects.toThrowError(/invalid/);
         emitter.emit("logLine", {}, 5);
         expect(handlers.has("getCount")).toBe(true);
         expect(emitter.listenerCount("logLine")).toBe(1);

         await expect(callCount(handlers, 1)).resolves.toBe("done");
         emitter.emit("logLine", {}, "y");
         emitter.emit("logLine", {}, "z");

         expect(answer).toHaveBeenCalledOnce();
         expect(handlers.has("getCount")).toBe(false);
         expect(heard).toHaveBeenCalledOnce();
         expect(emitter.listenerCount("logLine")).toBe(0);
      });

      it("gives once and handleOnce to one message only, even with an asynchronous schema", async () => {
         const { emitter, handlers, ipc } = await loadValidated({
            id: async (value) => isNumber(value),
            line: async (value) => ok(value),
         });
         const answer = vi.fn(() => "done");
         const heard = vi.fn();
         ipc.getCount.handleOnce(answer);
         ipc.logLine.once(heard);

         // Both messages are in flight before either one is accepted.
         const first = callCount(handlers, 1) as Promise<string>;
         const second = callCount(handlers, 2) as Promise<string>;
         emitter.emit("logLine", {}, "a");
         emitter.emit("logLine", {}, "b");

         await expect(first).resolves.toBe("done");
         await expect(second).rejects.toThrowError("No handler registered for 'getCount'");
         await new Promise((resolve) => setTimeout(resolve, 5));
         expect(answer).toHaveBeenCalledOnce();
         expect(heard).toHaveBeenCalledOnce();
         expect(heard).toHaveBeenCalledWith({}, "a");
      });

      it("generates files that type-check", async () => {
         const project = await generateFixture("argument-validation");
         expect(await project.typecheck()).toBe("");
      });
   });
});
