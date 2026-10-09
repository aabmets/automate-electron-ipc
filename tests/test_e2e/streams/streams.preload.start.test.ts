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

import { cleanupStreams } from "@testutils/e2e/stream-main-utils.js";
import { loadPreload, settleRead } from "@testutils/e2e/stream-preload-utils.js";
import { settle } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, preload script, a call that fails to start", () => {
   it("rejects the first read with the error of the envelope", async () => {
      const { api, invoke } = await loadPreload();
      const error = { name: "IpcForbiddenError", message: "not allowed", code: "IPC_FORBIDDEN" };
      invoke.mockResolvedValueOnce({ ok: false, error });
      const stream = api.guarded.stream(1);

      expect(await settleRead(stream.next())).toStrictEqual({ error });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("keeps going when the envelope says the call was accepted", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      await settle();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
   });

   it("rejects the read with the error of Electron when no handler is registered", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockRejectedValueOnce(
         new Error("Error invoking remote method 'autoipc:progress': No handler registered"),
      );
      const stream = api.progress.stream("job");

      expect(await settleRead(stream.next())).toStrictEqual({
         error: {
            name: "Error",
            message: "Error invoking remote method 'autoipc:progress': No handler registered",
         },
      });
   });

   it("rejects the read when the arguments cannot be sent", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockImplementationOnce(() => {
         throw Object.assign(new Error("An object could not be cloned."), {
            name: "DataCloneError",
         });
      });
      const stream = api.exportRows.stream("people");

      expect(await settleRead(stream.next())).toStrictEqual({
         error: { name: "DataCloneError", message: "An object could not be cloned." },
      });
   });

   it("rejects the read when the reply is not an envelope", async () => {
      const { api, invoke } = await loadPreload();
      invoke.mockResolvedValueOnce(undefined);
      const stream = api.counter.stream();

      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({
            name: "IpcStreamError",
            code: "IPC_STREAM_INVALID_REPLY",
         }),
      });
   });

   it("closes a port which arrives for a stream that has failed", async () => {
      const { api, invoke, arrive } = await loadPreload();
      invoke.mockResolvedValueOnce({ ok: false, error: { name: "Error", message: "no" } });
      api.counter.stream();
      await settle();

      const port = arrive("counter", 1);

      expect(port.close).toHaveBeenCalledOnce();
   });
});

describe("stream, preload script, cancelling", () => {
   it("tells the main process, closes the port, drops the chunks and ends the reads", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });
      const waiting = stream.next();
      port.deliver({ type: "chunk", value: 2 });
      await waiting;

      stream.cancel();
      stream.cancel();

      expect(port.postMessage.mock.calls).toStrictEqual([[{ type: "cancel" }]]);
      expect(port.close).toHaveBeenCalledOnce();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("ends a read which is waiting", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      arrive("counter", 1);
      const waiting = stream.next();

      stream.cancel();

      expect(await waiting).toStrictEqual({ done: true, value: undefined });
   });

   it("does the same for return(), which resolves done", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      expect(await stream.return()).toStrictEqual({ done: true, value: undefined });

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("calls return() when a for await loop breaks", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "chunk", value: 2 });

      for await (const chunk of stream) {
         expect(chunk).toBe(1);
         break;
      }

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("stops with an abort signal of the page", async () => {
      const { api, arrive } = await loadPreload();
      const controller = new AbortController();
      const stream = api.counter.stream();
      controller.signal.addEventListener("abort", () => stream.cancel(), { once: true });
      const port = arrive("counter", 1);

      controller.abort();

      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
   });

   it("closes a port that arrives after the cancel, and sends no message on it", async () => {
      const { api, invoke, arrive } = await loadPreload();
      const stream = api.counter.stream();

      stream.cancel();
      const port = arrive("counter", 1);

      expect(invoke).toHaveBeenCalledOnce();
      expect(port.close).toHaveBeenCalledOnce();
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("does nothing when the stream has ended", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "end" });

      stream.cancel();

      expect(port.postMessage).not.toHaveBeenCalled();
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("survives a port which cannot be posted to", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.postMessage.mockImplementation(() => {
         throw new Error("The port is closed");
      });

      expect(() => stream.cancel()).not.toThrow();
      expect(port.close).toHaveBeenCalledOnce();
   });
});
