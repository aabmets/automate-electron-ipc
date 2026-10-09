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

import { createContents } from "@testutils/e2e/fake-contents.js";
import { channelsMade } from "@testutils/e2e/fake-ports.js";
import { createSource } from "@testutils/e2e/runtime-utils.js";
import {
   cleanupStreams,
   createEvent,
   createFrame,
   lastChannel,
   loadMain,
   portWire,
   start,
} from "@testutils/e2e/stream-main-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process, starting a call", () => {
   it("registers a handler for the channel, which gets the event and the arguments but not the ID", async () => {
      const context = await loadMain();
      const { handler, envelope, contents } = await start(context, "exportRows", {
         args: ["people", 3],
      });

      expect(context.electron.ipcMain.handle).toHaveBeenCalledWith(
         wire("exportRows"),
         expect.any(Function),
      );
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
         expect.objectContaining({ sender: contents }),
         "people",
         3,
      );
      expect(envelope).toStrictEqual({ ok: true, value: undefined });
   });

   it("hands one port of a new channel to the frame that asked, with the ID of the call", async () => {
      const context = await loadMain();
      const { frame, contents } = await start(context, "counter", { id: 42 });

      expect(channelsMade).toHaveLength(1);
      expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(portWire("counter"), 42, [
         lastChannel().port2,
      ]);
      expect(contents.postMessage).not.toHaveBeenCalled();
      expect(lastChannel().port1.start).toHaveBeenCalledOnce();
   });

   it("falls back to the contents when the frame is gone", async () => {
      const context = await loadMain();
      for (const frame of [
         null,
         createFrame({ destroyed: true }),
         createFrame({ detached: true }),
      ]) {
         const contents = createContents();
         // biome-ignore lint/performance/noAwaitInLoops: each case starts its own call
         await start(context, "counter", { id: 5, contents, frame });

         expect(contents.postMessage).toHaveBeenCalledExactlyOnceWith(portWire("counter"), 5, [
            lastChannel().port2,
         ]);
         if (frame) {
            expect(frame.postMessage).not.toHaveBeenCalled();
         }
      }
   });

   it("gives every call a channel of its own", async () => {
      const context = await loadMain();
      await start(context, "counter", { id: 1 });
      const first = lastChannel();
      await start(context, "counter", { id: 2 });

      expect(channelsMade).toHaveLength(2);
      expect(lastChannel()).not.toBe(first);
   });

   it("answers a call without a numeric ID with an error, and runs nothing", async () => {
      const context = await loadMain();
      const { handler, envelope } = await start(context, "counter", { id: "7" });

      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({
            name: "IpcStreamError",
            code: "IPC_STREAM_INVALID_REQUEST",
         }),
      });
   });

   it("answers a handler which returns no async iterable with an error and makes no channel", async () => {
      const context = await loadMain();
      context.ipc.counter.handle(() => undefined);
      const envelope = await context.listener("counter")(createEvent(createContents()), 1);
      context.ipc.tokens.handle(() => ({ next: () => undefined }));
      const other = await context.listener("tokens")(createEvent(createContents()), 1, "x");

      for (const answer of [envelope, other]) {
         expect(answer).toStrictEqual({
            ok: false,
            error: expect.objectContaining({ code: "IPC_STREAM_NOT_ITERABLE" }),
         });
      }
      expect(channelsMade).toHaveLength(0);
   });

   it("answers an error that the handler throws before it returns, with its name, code and data", async () => {
      const context = await loadMain();
      context.ipc.counter.handle(() => {
         throw Object.assign(new Error("gone"), {
            name: "NotFoundError",
            code: "E_NOT_FOUND",
            data: { id: 1 },
         });
      });
      const envelope = await context.listener("counter")(createEvent(createContents()), 1);

      expect(envelope).toStrictEqual({
         ok: false,
         error: { name: "NotFoundError", message: "gone", code: "E_NOT_FOUND", data: { id: 1 } },
      });
      expect(channelsMade).toHaveLength(0);
   });

   it("closes the channel and stops the iterator when the port cannot be handed over", async () => {
      const context = await loadMain();
      const source = createSource();
      context.ipc.counter.handle(() => source.iterable);
      const frame = createFrame();
      frame.postMessage.mockImplementation(() => {
         throw new Error("The frame is gone");
      });

      const envelope = await context.listener("counter")(createEvent(createContents(), frame), 1);

      expect(envelope).toStrictEqual({
         ok: false,
         error: expect.objectContaining({ message: "The frame is gone" }),
      });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(source.iterator.next).not.toHaveBeenCalled();
   });
});
