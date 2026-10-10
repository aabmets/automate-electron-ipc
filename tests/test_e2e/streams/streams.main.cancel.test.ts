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
import {
   cleanupStreams,
   createEvent,
   fromPage,
   lastChannel,
   loadMain,
   posted,
   start,
} from "@testutils/e2e/stream-main-utils.js";
import { settle } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupStreams);

describe("stream, main process, cancelling", () => {
   it("calls return() on the generator once on a cancel message, and sends nothing after it", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");
      source.push(1);
      await settle();

      fromPage({ type: "cancel" });
      fromPage({ type: "cancel" });
      source.push(2);
      source.end();
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("calls return() while the generator is waiting, and drops the chunk it produces then", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      await settle();
      expect(source.iterator.next).toHaveBeenCalledOnce();

      fromPage({ type: "cancel" });
      expect(source.iterator.return).toHaveBeenCalledOnce();
      source.push("late");
      await settle();

      expect(posted()).toStrictEqual([]);
      expect(source.iterator.next).toHaveBeenCalledOnce();
   });

   it("cancels when the page closes its port", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      source.push(1);
      await settle();

      lastChannel().port1.emit("close");
      source.push(2);
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
   });

   it("cancels when the contents are destroyed", async () => {
      const context = await loadMain();
      const { source, contents } = await start(context, "counter");

      contents.emit("destroyed");
      lastChannel().port1.emit("close");
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(lastChannel().port1.close).toHaveBeenCalledOnce();
   });

   // Node warns about more than ten listeners of one event.
   it("keeps one 'destroyed' listener on the contents of any number of open streams", async () => {
      const context = await loadMain();
      const contents = createContents();
      const streams = [];
      for (let n = 0; n < 12; n++) {
         // biome-ignore lint/performance/noAwaitInLoops: each call starts after the last one
         streams.push(await start(context, "counter", { id: n, contents }));
      }

      expect(contents.listenerCount("destroyed")).toBe(1);

      // A stream that ends lets go of its own part only.
      streams[0].source.end();
      await settle();
      expect(contents.listenerCount("destroyed")).toBe(1);

      contents.emit("destroyed");
      await settle();

      for (const { source } of streams.slice(1)) {
         expect(source.iterator.return).toHaveBeenCalledOnce();
      }
      expect(streams[0].source.iterator.return).not.toHaveBeenCalled();
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("lets go of the contents when the last of many streams ends", async () => {
      const context = await loadMain();
      const contents = createContents();
      const streams = [];
      for (let n = 0; n < 3; n++) {
         // biome-ignore lint/performance/noAwaitInLoops: each call starts after the last one
         streams.push(await start(context, "counter", { id: n, contents }));
      }

      for (const { source } of streams) {
         source.end();
      }
      await settle();

      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("ignores messages of the page which are not a cancel", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");

      for (const data of [null, undefined, "cancel", 3, { type: "chunk" }, { kind: "cancel" }]) {
         fromPage(data);
      }
      source.push(1);
      await settle();

      expect(source.iterator.return).not.toHaveBeenCalled();
      expect(posted()).toStrictEqual([{ type: "chunk", value: 1 }]);
   });

   it("does not stop a generator which has ended when the port closes afterwards", async () => {
      const context = await loadMain();
      const { source } = await start(context, "counter");
      source.end();
      await settle();

      lastChannel().port1.emit("close");
      fromPage({ type: "cancel" });

      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("runs the finally block of a real async generator when the page cancels", async () => {
      const context = await loadMain();
      const log: string[] = [];
      context.ipc.counter.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
               await new Promise((resolve) => setTimeout(resolve, 1));
               yield n;
            }
         } finally {
            log.push("finally");
         }
      });
      await context.listener("counter")(createEvent(createContents()), 1);
      await vi.waitFor(() => expect(posted().length).toBeGreaterThan(0));

      fromPage({ type: "cancel" });
      await settle();
      const count = posted().length;
      await settle();

      expect(log).toStrictEqual(["finally"]);
      expect(count).toBeGreaterThan(0);
      expect(posted()).toHaveLength(count);
   });
});
