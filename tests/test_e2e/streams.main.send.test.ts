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
   cleanupStreams,
   lastChannel,
   loadMain,
   posted,
   settle,
   start,
} from "@testutils/stream-main-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process, sending", () => {
   it("sends the chunks in order, then the end, and closes the port", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");

      source.push(1);
      source.push({ nested: [2] });
      source.push("three");
      source.end();
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: 1 },
         { type: "chunk", value: { nested: [2] } },
         { type: "chunk", value: "three" },
         { type: "end" },
      ]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).not.toHaveBeenCalled();
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("keeps the order of chunks which the generator produced before the first was sent", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      for (let value = 0; value < 200; value++) {
         source.push(value);
      }
      source.end();
      await settle();

      expect(posted().slice(0, -1)).toStrictEqual(
         Array.from({ length: 200 }, (_, value) => ({ type: "chunk", value })),
      );
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });

   it("sends an empty stream as the end alone", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.end();
      await settle();

      expect(posted()).toStrictEqual([{ type: "end" }]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("sends the error of the generator after the chunks before it, and closes the port", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.push(1);
      source.fail({ name: "Boom", message: "exploded", code: "E1", data: { n: 1 } });
      source.push(2);
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: 1 },
         {
            type: "error",
            error: { name: "Boom", message: "exploded", code: "E1", data: { n: 1 } },
         },
      ]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      // A generator which threw has finished, so there is nothing to stop.
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("reduces an Error of the generator to its name and message", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      source.fail(new TypeError("bad input"));
      await settle();

      expect(posted()).toStrictEqual([
         { type: "error", error: { name: "TypeError", message: "bad input" } },
      ]);
   });

   it("fails the stream when a chunk cannot be sent, and stops the generator", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      lastChannel().port1.postMessage.mockImplementationOnce(() => undefined);
      lastChannel().port1.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      source.push("fine");
      source.push(() => 1);
      source.push("never sent");
      await settle();

      expect(posted()).toStrictEqual([
         { type: "chunk", value: "fine" },
         { type: "chunk", value: expect.any(Function) },
         {
            type: "error",
            error: {
               name: "IpcStreamError",
               message:
                  "A chunk of the channel 'counter' cannot be sent: An object could not be cloned.",
               code: "IPC_STREAM_UNSENDABLE",
            },
         },
      ]);
      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("keeps running two calls of a channel apart", async () => {
      const context = await loadMain();
      const first = await start(context, "counter", { id: 1 });
      const firstChannel = lastChannel();
      const second = await start(context, "counter", { id: 2 });
      const secondChannel = lastChannel();

      first.source.push("a");
      second.source.push("b");
      second.source.end();
      await settle();
      firstChannel.port1.emit("message", { data: { type: "cancel" } });

      expect(firstChannel.port1.postMessage.mock.calls).toStrictEqual([
         [{ type: "chunk", value: "a" }],
      ]);
      expect(secondChannel.port1.postMessage.mock.calls).toStrictEqual([
         [{ type: "chunk", value: "b" }],
         [{ type: "end" }],
      ]);
      expect(first.source.iterator.return).toHaveBeenCalledOnce();
      expect(second.source.iterator.return).not.toHaveBeenCalled();
   });
});
