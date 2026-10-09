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

import { createSource } from "@testutils/runtime-utils.js";
import {
   channelsMade,
   cleanupStreams,
   createContents,
   createEvent,
   createFrame,
   fromPage,
   lastChannel,
   loadMain,
   posted,
   settle,
   start,
} from "@testutils/stream-main-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process, flow control", () => {
   const credit = (limit: unknown) => ({ type: "credit", limit });
   /** The values of the chunks that were sent, in order. */
   const sentValues = () =>
      posted()
         .filter((message) => message.type === "chunk")
         .map((message) => message.value);
   const upTo = (count: number) => Array.from({ length: count }, (_, value) => value);
   const fill = (source: ReturnType<typeof createSource>, count: number) => {
      for (const value of upTo(count)) {
         source.push(value);
      }
   };

   it("stops pulling from the generator once highWaterMark chunks are sent, and goes on when the page grants more", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");

      fill(source, 10);
      await settle();
      expect(sentValues()).toStrictEqual(upTo(4));
      expect(source.iterator.next).toHaveBeenCalledTimes(4);

      fromPage(credit(6));
      await settle();
      expect(sentValues()).toStrictEqual(upTo(6));
      expect(source.iterator.next).toHaveBeenCalledTimes(6);

      fromPage(credit(100));
      source.end();
      await settle();
      expect(sentValues()).toStrictEqual(upTo(10));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("uses a window of 1024 chunks when the channel sets none", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      fill(source, 1500);
      await settle();
      expect(sentValues()).toHaveLength(1024);
      expect(source.iterator.next).toHaveBeenCalledTimes(1024);

      fromPage(credit(1600));
      await settle();
      expect(sentValues()).toStrictEqual(upTo(1500));
   });

   it("never pauses a channel with an infinite window", async () => {
      const context = await loadMain();
      const { source } = await start(context, "unbounded");

      fill(source, 3000);
      source.end();
      await settle();

      expect(sentValues()).toStrictEqual(upTo(3000));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });

   it("pulls only what the page grants when the window is 0", async () => {
      const context = await loadMain();
      const { source } = await start(context, "pulled");

      fill(source, 3);
      await settle();
      expect(source.iterator.next).not.toHaveBeenCalled();
      expect(posted()).toStrictEqual([]);

      fromPage(credit(1));
      await settle();
      expect(sentValues()).toStrictEqual([0]);

      fromPage(credit(3));
      await settle();
      expect(sentValues()).toStrictEqual([0, 1, 2]);
      expect(source.iterator.next).toHaveBeenCalledTimes(3);
   });

   it("ignores a credit which does not raise the limit, or is not a number", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 10);
      await settle();

      // The credits come in the same turn as one that raises the limit to 8, before the paused
      // generator goes on, so a lower one that was taken would shrink the window it has.
      fromPage(credit(8));
      for (const limit of [7, 4, 0, -5, "9", Number.NaN, null, undefined, {}, [9], true]) {
         fromPage(credit(limit));
      }
      fromPage({ type: "credit" });
      fromPage({ type: "creditt", limit: 9 });
      fromPage(null);
      await settle();

      expect(sentValues()).toStrictEqual(upTo(8));
      expect(source.iterator.next).toHaveBeenCalledTimes(8);
   });

   it("keeps the credits of two calls apart", async () => {
      const context = await loadMain();
      const first = await start(context, "windowed", { id: 1 });
      const second = await start(context, "windowed", { id: 2 });
      fill(first.source, 10);
      fill(second.source, 10);
      await settle();

      channelsMade[1].port1.emit("message", { data: credit(7) });
      await settle();

      expect(channelsMade[0].port1.postMessage).toHaveBeenCalledTimes(4);
      expect(channelsMade[1].port1.postMessage).toHaveBeenCalledTimes(7);
   });

   it("cancels a paused stream: the generator runs its finally block at once, and nothing is sent", async () => {
      const context = await loadMain();
      let produced = 0;
      let finalized = 0;
      context.ipc.windowed.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               produced += 1;
               yield n;
            }
         } finally {
            finalized += 1;
         }
      });
      await context.listener("windowed")(createEvent(createContents(), createFrame()), 7);
      await settle();
      expect(produced).toBe(4);
      expect(finalized).toBe(0);

      fromPage({ type: "cancel" });
      await settle();
      fromPage(credit(50));
      await settle();

      expect(finalized).toBe(1);
      expect(produced).toBe(4);
      expect(sentValues()).toStrictEqual(upTo(4));
      expect(posted().some((message) => message.type === "end" || message.type === "error")).toBe(
         false,
      );
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("stops a paused stream when the page closes the port, and when the contents are destroyed", async () => {
      const context = await loadMain();
      const closed = await start(context, "windowed", { id: 1 });
      const contents = createContents();
      const destroyed = await start(context, "windowed", { id: 2, contents });
      fill(closed.source, 10);
      fill(destroyed.source, 10);
      await settle();

      channelsMade[0].port1.emit("close");
      contents.emit("destroyed");
      await settle();
      channelsMade[0].port1.emit("message", { data: credit(50) });
      channelsMade[1].port1.emit("message", { data: credit(50) });
      await settle();

      expect(closed.source.iterator.return).toHaveBeenCalledOnce();
      expect(destroyed.source.iterator.return).toHaveBeenCalledOnce();
      expect(closed.source.iterator.next).toHaveBeenCalledTimes(4);
      expect(destroyed.source.iterator.next).toHaveBeenCalledTimes(4);
      expect(channelsMade[0].port1.postMessage).toHaveBeenCalledTimes(4);
      expect(channelsMade[1].port1.postMessage).toHaveBeenCalledTimes(4);
   });

   it("sends the error of the generator after the chunks, once the page has granted the pull that finds it", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 4);
      source.fail({ name: "Boom", message: "exploded", code: "E1" });
      await settle();
      expect(posted()).toHaveLength(4);

      fromPage(credit(5));
      await settle();

      expect(posted().slice(0, 4)).toStrictEqual(
         upTo(4).map((value) => ({ type: "chunk", value })),
      );
      expect(posted()[4]).toStrictEqual({
         type: "error",
         error: { name: "Boom", message: "exploded", code: "E1" },
      });
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   it("keeps the order of the chunks across many pauses", async () => {
      const context = await loadMain();
      const { source } = await start(context, "windowed");
      fill(source, 100);
      source.end();

      for (let limit = 4; limit <= 104; limit += 2) {
         // biome-ignore lint/performance/noAwaitInLoops: each grant lets the pump run to the next pause
         await settle();
         fromPage(credit(limit));
      }
      await settle();

      expect(sentValues()).toStrictEqual(upTo(100));
      expect(posted().at(-1)).toStrictEqual({ type: "end" });
   });
});
