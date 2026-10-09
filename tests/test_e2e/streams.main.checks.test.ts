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
   channelsMade,
   cleanupStreams,
   createFrame,
   loadMain,
   start,
   wire,
} from "@testutils/stream-main-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process, handler registration", () => {
   it("replaces the handler of the channel, and a replaced disposer does nothing", async () => {
      const { ipc, electron } = await loadMain();
      const stopFirst = ipc.counter.handle(async function* () {});
      const stopSecond = ipc.counter.handle(async function* () {});

      stopFirst();
      expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(2);
      electron.ipcMain.removeHandler.mockClear();
      stopSecond();

      expect(electron.ipcMain.removeHandler).toHaveBeenCalledExactlyOnceWith(wire("counter"));
   });

   it("has no handleOnce", async () => {
      const { ipc } = await loadMain();

      expect(Object.keys(ipc.counter)).toStrictEqual(["handle"]);
      expect(Object.keys(ipc.getUser)).toStrictEqual(["handle", "handleOnce"]);
   });
});

describe("stream, main process, sender and argument checks", () => {
   it("rejects a sender of another origin with the envelope, and runs nothing", async () => {
      const context = await loadMain();
      const onRejected = vi.fn();
      context.configureIpc({ onRejected });
      const { handler, envelope } = await start(context, "guarded", {
         args: [3],
         frame: createFrame({ origin: "https://evil.example" }),
      });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({ name: "IpcForbiddenError", code: "IPC_FORBIDDEN" }),
      });
      expect(onRejected).toHaveBeenCalledOnce();
   });

   it("rejects a call without a frame, and applies validateSender", async () => {
      const context = await loadMain();
      const noFrame = await start(context, "guarded", { args: [3], frame: null });
      expect(noFrame.envelope).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });

      context.configureIpc({ validateSender: () => false });
      const refused = await start(context, "guarded", { args: [3] });
      expect(refused.envelope).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
      expect(channelsMade).toHaveLength(0);
   });

   it("lets an allowed sender with valid arguments start the stream", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "guarded", { args: [3] });

      expect(envelope).toStrictEqual({ ok: true, value: undefined });
      expect(handler).toHaveBeenCalledWith(expect.anything(), 3);
      expect(channelsMade).toHaveLength(1);
   });

   it("answers invalid arguments with the validation error and its issues, before the handler", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "guarded", { args: ["three"] });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: {
            name: "IpcValidationError",
            message: "The arguments of the channel 'guarded' are invalid: expected one number",
            code: "IPC_VALIDATION",
            data: [{ message: "expected one number", path: undefined }],
         },
      });
   });

   it("never starts a stream for a sender which an unvalidated channel does not restrict", async () => {
      const context = await loadMain();
      const { envelope } = await start(context, "counter", { frame: null });

      expect(envelope).toStrictEqual({ ok: true, value: undefined });
   });
});
