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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import { createSource } from "@testutils/e2e/runtime-utils.js";
import {
   cancel,
   cleanupUtilityPorts,
   FakeBrokerPort,
   flush,
   loadUtility,
   settle,
   startStream,
   wire,
} from "@testutils/e2e/utility-port-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the utility process, flow control", () => {
   const credit = (channel: string, id: number, limit: unknown) => ({
      __ipc: "credit",
      channel: wire(channel),
      id,
      limit,
   });
   const upTo = (count: number) => Array.from({ length: count }, (_, value) => value);
   const fill = (source: ReturnType<typeof createSource>, count: number) => {
      for (const value of upTo(count)) {
         source.push(value);
      }
   };
   /** The values of the chunks of one call that were sent to the page. */
   const sentValues = (port: FakeBrokerPort, id: number) =>
      port
         .posted("chunk")
         .filter((message) => message.id === id)
         .map((message) => message.value);

   it("stops pulling from the generator at the window of the channel, and goes on when the page grants more", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");

      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 10);
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(source.iterator.next).toHaveBeenCalledTimes(4);

      port.fromPage(credit("windowedRows", 1, 6));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(6));

      port.fromPage(credit("windowedRows", 1, 100));
      source.end();
      await settle();
      expect(sentValues(port, 1)).toStrictEqual(upTo(10));
      expect(port.posted("end")).toHaveLength(1);
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("gives every call a window of its own on the shared port", async () => {
      const { ipc, broker } = await loadUtility();
      const sources = [createSource(), createSource()];
      let opened = 0;
      ipc.windowedRows.handle(() => sources[opened++].iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      port.fromPage(startStream("windowedRows", 2));
      await flush();
      fill(sources[0], 10);
      fill(sources[1], 10);
      await settle();

      port.fromPage(credit("windowedRows", 2, 7));
      port.fromPage(credit("windowedRows", 99, 7));
      port.fromPage(credit("pulledRows", 1, 7));
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(sentValues(port, 2)).toStrictEqual(upTo(7));
   });

   it("uses a window of 1024 chunks when the channel sets none, and never pauses an infinite one", async () => {
      const { ipc, broker } = await loadUtility();
      const standard = createSource();
      const unbounded = createSource();
      ipc.counter.handle(() => standard.iterable as never);
      ipc.unboundedRows.handle(() => unbounded.iterable);
      const counter = broker("counter");
      const rows = broker("unboundedRows");
      counter.fromPage(startStream("counter", 1));
      rows.fromPage(startStream("unboundedRows", 1));
      await flush();

      fill(standard, 1500);
      fill(unbounded, 3000);
      unbounded.end();
      await settle();

      expect(sentValues(counter, 1)).toHaveLength(1024);
      expect(sentValues(rows, 1)).toStrictEqual(upTo(3000));
      expect(rows.posted("end")).toHaveLength(1);
   });

   it("pulls only what the page grants when the window is 0", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.pulledRows.handle(() => source.iterable);
      const port = broker("pulledRows");
      port.fromPage(startStream("pulledRows", 1));
      await flush();
      fill(source, 3);
      await settle();
      expect(source.iterator.next).not.toHaveBeenCalled();

      port.fromPage(credit("pulledRows", 1, 1));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual([0]);

      port.fromPage(credit("pulledRows", 1, 3));
      await settle();
      expect(sentValues(port, 1)).toStrictEqual([0, 1, 2]);
   });

   it("ignores a credit which does not raise the limit, or is not a number", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 10);
      await settle();

      // The credits come in the same turn as one that raises the limit to 8, before the paused
      // generator goes on, so a lower one that was taken would shrink the window it has.
      port.fromPage(credit("windowedRows", 1, 8));
      for (const limit of [7, 4, 0, -1, "9", Number.NaN, null, undefined, {}, true]) {
         port.fromPage(credit("windowedRows", 1, limit));
      }
      port.fromPage({ __ipc: "credit", channel: wire("windowedRows"), id: "1", limit: 9 });
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(8));
   });

   it("cancels a paused stream at once, and ignores a credit which comes after", async () => {
      const { ipc, broker } = await loadUtility();
      let produced = 0;
      let finalized = 0;
      ipc.windowedRows.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               produced += 1;
               yield n;
            }
         } finally {
            finalized += 1;
         }
      });
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await settle();
      expect(produced).toBe(4);

      port.fromPage(cancel("windowedRows", 1));
      await settle();
      port.fromPage(credit("windowedRows", 1, 50));
      await settle();

      expect(finalized).toBe(1);
      expect(produced).toBe(4);
      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(port.posted("end")).toHaveLength(0);
      expect(port.posted("error")).toHaveLength(0);
   });

   it("stops every paused stream when the port closes", async () => {
      const { ipc, broker } = await loadUtility();
      const sources = [createSource(), createSource()];
      let opened = 0;
      ipc.windowedRows.handle(() => sources[opened++].iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      port.fromPage(startStream("windowedRows", 2));
      await flush();
      fill(sources[0], 10);
      fill(sources[1], 10);
      await settle();

      port.emit("close");
      await settle();

      for (const source of sources) {
         expect(source.iterator.return).toHaveBeenCalledOnce();
         expect(source.iterator.next).toHaveBeenCalledTimes(4);
      }
   });

   it("sends the error of the generator after the chunks, once the page has granted the pull that finds it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.windowedRows.handle(() => source.iterable);
      const port = broker("windowedRows");
      port.fromPage(startStream("windowedRows", 1));
      await flush();
      fill(source, 4);
      source.fail({ name: "Boom", message: "exploded", code: "E1" });
      await settle();
      expect(port.posted("error")).toHaveLength(0);

      port.fromPage(credit("windowedRows", 1, 5));
      await settle();

      expect(sentValues(port, 1)).toStrictEqual(upTo(4));
      expect(port.posted("error")).toStrictEqual([
         {
            __ipc: "error",
            channel: wire("windowedRows"),
            id: 1,
            error: { name: "Boom", message: "exploded", code: "E1" },
         },
      ]);
   });
});
