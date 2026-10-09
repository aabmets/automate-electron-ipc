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

import { cleanupRuntime, generateFixture } from "@testutils/e2e/runtime-main-utils.js";
import {
   getSecret,
   loadSenderFixture,
   senderFrame,
} from "@testutils/e2e/runtime-validation-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupRuntime);

describe("generated main process bindings", () => {
   describe("sender validation", () => {
      it("exports configureIpc and IpcForbiddenError only when there are renderer-to-main channels", async () => {
         const { generated } = await loadSenderFixture();
         expect(typeof generated.configureIpc).toBe("function");
         expect(new generated.IpcForbiddenError("x")).toBeInstanceOf(Error);

         let project = await generateFixture("port-only");
         expect(project.generated["main.ts"]).not.toContain("configureIpc");
         await project.cleanup();
         project = undefined;
      });

      it("describes the rejected channel in an IpcForbiddenError", async () => {
         const { generated } = await loadSenderFixture();
         const error = new generated.IpcForbiddenError("getSecret");

         expect(error.name).toBe("IpcForbiddenError");
         expect(error.channel).toBe("getSecret");
         expect(error.message).toContain("'getSecret'");
      });

      it("checks nothing when no validator and no origins apply", async () => {
         const { emitter, handlers, ipc } = await loadSenderFixture();
         const callback = vi.fn();
         ipc.getPublic.handle(async () => 7);
         ipc.ping.on(callback);

         // Not even a frame: nothing is configured for these channels.
         await expect(handlers.get("getPublic")?.({})).resolves.toBe(7);
         emitter.emit("ping", { senderFrame: null });
         expect(callback).toHaveBeenCalledOnce();
      });

      it.each(["app://.", "http://localhost:5173"])(
         "lets the allowed origin %s call an invoke channel",
         async (origin) => {
            const { handlers, ipc } = await loadSenderFixture();
            const callback = vi.fn(async (_event: unknown, id: number) => `secret ${id}`);
            ipc.getSecret.handle(callback);

            const event = senderFrame(origin);
            await expect(getSecret(handlers, event, 4)).resolves.toBe("secret 4");
            expect(callback).toHaveBeenCalledWith(event, 4);
         },
      );

      it("rejects a call from another origin with an IpcForbiddenError and does not run the handler", async () => {
         const { generated, handlers, ipc } = await loadSenderFixture();
         const callback = vi.fn(async () => "secret");
         ipc.getSecret.handle(callback);

         await expect(
            getSecret(handlers, senderFrame("https://example.com")),
         ).rejects.toMatchObject({
            name: "IpcForbiddenError",
            code: "IPC_FORBIDDEN",
            message: expect.stringContaining("'getSecret'"),
         });
         expect(generated.IpcForbiddenError).toBeTypeOf("function");
         expect(callback).not.toHaveBeenCalled();
      });

      it("drops a send from another origin and delivers one from an allowed origin", async () => {
         const { emitter, ipc } = await loadSenderFixture();
         const callback = vi.fn();
         ipc.logLine.on(callback);

         expect(() =>
            emitter.emit("logLine", senderFrame("https://example.com"), "bad"),
         ).not.toThrow();
         emitter.emit("logLine", senderFrame("app://."), "good");

         expect(callback).toHaveBeenCalledOnce();
         expect(callback).toHaveBeenCalledWith(expect.anything(), "good");
      });

      it("allows only the origins of its own channel", async () => {
         const { emitter, ipc } = await loadSenderFixture();
         const callback = vi.fn();
         ipc.logLine.on(callback);

         // `http://localhost:5173` may call getSecret but not logLine.
         emitter.emit("logLine", senderFrame("http://localhost:5173"), "text");

         expect(callback).not.toHaveBeenCalled();
      });

      it("rejects a null sender frame, a missing one and a frame without a string origin", async () => {
         const { emitter, handlers, ipc } = await loadSenderFixture();
         const callback = vi.fn();
         ipc.logLine.on(callback);
         ipc.getSecret.handle(async () => "secret");

         for (const event of [
            { senderFrame: null },
            {},
            senderFrame(undefined),
            senderFrame(null),
            senderFrame(5173),
            senderFrame(["app://."]),
         ]) {
            emitter.emit("logLine", event, "text");
            // biome-ignore lint/performance/noAwaitInLoops: the cases are checked in order
            await expect(getSecret(handlers, event)).rejects.toThrowError(/not allowed/);
         }
         expect(callback).not.toHaveBeenCalled();
      });

      it.each([
         "app://.attacker.com",
         "app://./",
         "app://",
         "http://localhost:5173.attacker.com",
         "http://localhost:51730",
         "http://localhost:5173/",
         "http://localhost",
         "https://localhost:5173",
         "http://example.com.attacker.com",
         "http://example.com#http://localhost:5173",
         "HTTP://LOCALHOST:5173",
         " app://.",
         "",
      ])(
         "rejects the lookalike origin '%s', since origins are compared for equality",
         async (origin) => {
            const { handlers, ipc } = await loadSenderFixture();
            ipc.getSecret.handle(async () => "secret");

            await expect(getSecret(handlers, senderFrame(origin))).rejects.toThrowError(
               /not allowed/,
            );
         },
      );

      it("reads the sender frame before the handler runs, since it can become null", async () => {
         const { handlers, ipc } = await loadSenderFixture();
         let reads = 0;
         const event = {
            get senderFrame() {
               reads += 1;
               // Detached after the first read, as Electron does for a frame which is gone.
               return reads === 1 ? { origin: "app://." } : null;
            },
         };
         const callback = vi.fn(async () => {
            await Promise.resolve();
            return "secret";
         });
         ipc.getSecret.handle(callback);

         await expect(getSecret(handlers, event)).resolves.toBe("secret");
         expect(reads).toBe(1);
      });
   });
});
