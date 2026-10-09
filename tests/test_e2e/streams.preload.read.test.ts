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

import { cleanupStreams } from "@testutils/stream-main-utils.js";
import { loadPreload, settleRead } from "@testutils/stream-preload-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, preload script, reading", () => {
   it("reads the chunks in order, then done", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "chunk", value: { a: 1 } });
      port.deliver({ type: "end" });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await stream.next()).toStrictEqual({ done: false, value: { a: 1 } });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("resolves a read which waits for the chunk, and several reads in the order they were made", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const reads = [stream.next(), stream.next(), stream.next(), stream.next()];

      port.deliver({ type: "chunk", value: "a" });
      port.deliver({ type: "chunk", value: "b" });
      port.deliver({ type: "end" });

      expect(await Promise.all(reads)).toStrictEqual([
         { done: false, value: "a" },
         { done: false, value: "b" },
         { done: true, value: undefined },
         { done: true, value: undefined },
      ]);
   });

   it("works with for await, and returns the chunks of several streams without mixing them", async () => {
      const { api, arrive } = await loadPreload();
      const one = api.counter.stream();
      const two = api.counter.stream();
      const portOne = arrive("counter", 1);
      const portTwo = arrive("counter", 2);
      portOne.deliver({ type: "chunk", value: "one" });
      portTwo.deliver({ type: "chunk", value: "two" });
      portOne.deliver({ type: "end" });
      portTwo.deliver({ type: "end" });

      const collect = async (stream: AsyncIterable<unknown>) => {
         const seen: unknown[] = [];
         for await (const chunk of stream) {
            seen.push(chunk);
         }
         return seen;
      };

      expect(await collect(one)).toStrictEqual(["one"]);
      expect(await collect(two)).toStrictEqual(["two"]);
   });

   it("rejects a read with the error object, after the chunks which came before it", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const error = { name: "Boom", message: "exploded", code: "E1", data: { n: 1 } };

      port.deliver({ type: "chunk", value: 1 });
      port.deliver({ type: "error", error });
      port.deliver({ type: "chunk", value: "ignored" });

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settleRead(stream.next())).toStrictEqual({ error });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("rejects a waiting read when the error arrives, and a for await loop throws it", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      const error = { name: "Boom", message: "exploded" };

      const loop = (async () => {
         for await (const _chunk of stream) {
            // Reads until the error.
         }
      })();
      port.deliver({ type: "error", error });

      await expect(loop).rejects.toStrictEqual(error);
   });

   it("ignores messages which are not chunks, ends or errors, and ones after the end", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);

      port.deliver(null);
      port.deliver("chunk");
      port.deliver({ type: "unknown", value: 1 });
      port.deliver({ type: "chunk", value: "kept" });
      port.deliver({ type: "end" });
      port.deliver({ type: "chunk", value: "late" });

      expect(await stream.next()).toStrictEqual({ done: false, value: "kept" });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });
});

describe("stream, preload script, a port that goes away", () => {
   it("fails the stream with IPC_STREAM_CLOSED when the port closes before the end", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();
      const port = arrive("counter", 1);
      port.deliver({ type: "chunk", value: 1 });

      port.emitClose();

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settleRead(stream.next())).toStrictEqual({
         error: {
            name: "IpcStreamError",
            message: "The stream of the channel 'counter' was closed before it ended",
            code: "IPC_STREAM_CLOSED",
         },
      });
   });

   it("ignores the close of the port after the end, the error and the cancel", async () => {
      const { api, arrive } = await loadPreload();
      const ended = api.counter.stream();
      const failed = api.counter.stream();
      const cancelled = api.counter.stream();
      const portEnded = arrive("counter", 1);
      const portFailed = arrive("counter", 2);
      const portCancelled = arrive("counter", 3);
      portEnded.deliver({ type: "end" });
      portFailed.deliver({ type: "error", error: { name: "Boom", message: "x" } });
      cancelled.cancel();

      for (const port of [portEnded, portFailed, portCancelled]) {
         port.emitClose();
      }

      expect(await ended.next()).toStrictEqual({ done: true, value: undefined });
      expect(await settleRead(failed.next())).toStrictEqual({
         error: { name: "Boom", message: "x" },
      });
      expect(await cancelled.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("closes a port for an ID which no stream waits for, or no port at all", async () => {
      const { api, arrive } = await loadPreload();
      const stream = api.counter.stream();

      const stray = arrive("counter", 99);
      const wrongType = arrive("counter", "1");
      arrive("counter", 1, undefined);

      expect(stray.close).toHaveBeenCalledOnce();
      expect(wrongType.close).toHaveBeenCalledOnce();
      stream.cancel();
   });
});
