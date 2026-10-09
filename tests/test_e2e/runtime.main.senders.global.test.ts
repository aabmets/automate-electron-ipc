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
import { getSecret, loadSenderFixture, senderFrame } from "@testutils/runtime-validation-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupRuntime);

describe("generated main process bindings", () => {
   describe("sender validation", () => {
      it("runs the global validator with the event and the channel name, for every channel", async () => {
         const { generated, emitter, handlers, ipc } = await loadSenderFixture();
         const validateSender = vi.fn(() => true);
         generated.configureIpc({ validateSender });
         const callback = vi.fn();
         ipc.ping.on(callback);
         ipc.getPublic.handle(async () => 7);

         const event = senderFrame("app://.");
         emitter.emit("ping", event);
         await handlers.get("getPublic")?.(event);

         expect(validateSender).toHaveBeenCalledWith(event, "ping");
         expect(validateSender).toHaveBeenCalledWith(event, "getPublic");
         expect(callback).toHaveBeenCalledOnce();
      });

      it("rejects when the global validator says no, even for an allowed origin", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         generated.configureIpc({ validateSender: () => false });
         ipc.getSecret.handle(async () => "secret");
         ipc.getPublic.handle(async () => 7);

         await expect(getSecret(handlers, senderFrame("app://."))).rejects.toThrowError(
            /not allowed/,
         );
         await expect(handlers.get("getPublic")?.(senderFrame("app://."))).rejects.toThrowError(
            /not allowed/,
         );
      });

      it("rejects an origin which the channel does not allow, even when the global validator says yes", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         generated.configureIpc({ validateSender: () => true });
         ipc.getSecret.handle(async () => "secret");

         await expect(getSecret(handlers, senderFrame("https://example.com"))).rejects.toThrowError(
            /not allowed/,
         );
         await expect(getSecret(handlers, senderFrame("app://."))).resolves.toBe("secret");
      });

      it("rejects a null frame when only the global validator applies", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         const validateSender = vi.fn(() => true);
         generated.configureIpc({ validateSender });
         ipc.getPublic.handle(async () => 7);

         await expect(handlers.get("getPublic")?.({ senderFrame: null })).rejects.toThrowError(
            /not allowed/,
         );
         expect(validateSender).not.toHaveBeenCalled();
      });

      it("rejects when the global validator throws or returns a value which is not true", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         ipc.getPublic.handle(async () => 7);

         for (const validateSender of [
            () => {
               throw new Error("broken");
            },
            () => "yes",
            () => 1,
            () => undefined,
         ]) {
            generated.configureIpc({ validateSender });
            // biome-ignore lint/performance/noAwaitInLoops: each case replaces the validator
            await expect(handlers.get("getPublic")?.(senderFrame("app://."))).rejects.toThrowError(
               /not allowed/,
            );
         }
      });

      it("calls onRejected for each rejected call, with the event and the channel, and never for an allowed one", async () => {
         const { generated, emitter, handlers, ipc } = await loadSenderFixture();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getSecret.handle(async () => "secret");
         ipc.logLine.on(vi.fn());

         const bad = senderFrame("https://example.com");
         await expect(getSecret(handlers, bad)).rejects.toThrowError(/not allowed/);
         emitter.emit("logLine", bad, "text");
         await getSecret(handlers, senderFrame("app://."));
         emitter.emit("logLine", senderFrame("app://."), "text");

         expect(onRejected.mock.calls).toStrictEqual([
            [bad, "getSecret"],
            [bad, "logLine"],
         ]);
      });

      it("rejects as usual when onRejected throws", async () => {
         const { generated, emitter, handlers, ipc } = await loadSenderFixture();
         generated.configureIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });
         const callback = vi.fn();
         ipc.getSecret.handle(async () => "secret");
         ipc.logLine.on(callback);

         await expect(getSecret(handlers, senderFrame("https://example.com"))).rejects.toThrowError(
            /not allowed/,
         );
         expect(() =>
            emitter.emit("logLine", senderFrame("https://example.com"), "x"),
         ).not.toThrow();
         expect(callback).not.toHaveBeenCalled();
      });

      it("replaces the whole configuration on each configureIpc call", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         ipc.getPublic.handle(async () => 7);
         generated.configureIpc({ validateSender: () => false });
         await expect(handlers.get("getPublic")?.(senderFrame("app://."))).rejects.toThrowError(
            /not allowed/,
         );

         generated.configureIpc({});

         await expect(handlers.get("getPublic")?.({})).resolves.toBe(7);
      });

      it("does not use up handleOnce or once with a rejected sender", async () => {
         const { emitter, handlers, ipc } = await loadSenderFixture();
         const answer = vi.fn(async () => "secret");
         const heard = vi.fn();
         ipc.getSecret.handleOnce(answer);
         ipc.logLine.once(heard);
         const bad = senderFrame("https://example.com");

         await expect(getSecret(handlers, bad)).rejects.toThrowError(/not allowed/);
         emitter.emit("logLine", bad, "x");
         expect(handlers.has("getSecret")).toBe(true);
         expect(emitter.listenerCount("logLine")).toBe(1);

         await expect(getSecret(handlers, senderFrame("app://."))).resolves.toBe("secret");
         emitter.emit("logLine", senderFrame("app://."), "y");
         emitter.emit("logLine", senderFrame("app://."), "z");

         expect(answer).toHaveBeenCalledOnce();
         expect(handlers.has("getSecret")).toBe(false);
         expect(heard).toHaveBeenCalledOnce();
         expect(emitter.listenerCount("logLine")).toBe(0);
      });

      it("generates files that type-check", async () => {
         const project = await generateFixture("sender-validation");
         expect(await project.typecheck()).toBe("");
      });
   });
});
