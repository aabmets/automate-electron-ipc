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

import { channelsMade, cleanupStreams, settle } from "@testutils/e2e/stream-main-utils.js";
import { settleRead } from "@testutils/e2e/stream-preload-utils.js";
import { loadBoth } from "@testutils/e2e/stream-real-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupStreams);

describe("a main process and a page over real message channels", () => {
   it("streams the rows of an async generator to a for await loop", async () => {
      const { ipc, api } = await loadBoth();
      ipc.exportRows.handle(async function* (_event: unknown, table: string, limit = 3) {
         for (let id = 1; id <= limit; id++) {
            yield { id, label: `${table}-${id}` };
         }
      });

      const rows: unknown[] = [];
      for await (const row of api.exportRows.stream("people", 4)) {
         rows.push(row);
      }

      expect(rows).toStrictEqual([
         { id: 1, label: "people-1" },
         { id: 2, label: "people-2" },
         { id: 3, label: "people-3" },
         { id: 4, label: "people-4" },
      ]);
   });

   it("keeps the order of a thousand chunks which are produced without waiting", async () => {
      const { ipc, api } = await loadBoth();
      ipc.asForm.handle(async function* (_event: unknown, count: number) {
         for (let n = 0; n < count; n++) {
            yield n;
         }
      });

      const seen: number[] = [];
      for await (const n of api.asForm.stream(1000)) {
         seen.push(n);
      }

      expect(seen).toStrictEqual(Array.from({ length: 1000 }, (_, n) => n));
   });

   it("ends a stream without chunks", async () => {
      const { ipc, api } = await loadBoth();
      ipc.counter.handle(async function* () {});

      const stream = api.counter.stream();

      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("stops the generator when the page breaks out of the loop, and runs its finally block", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.counter.handle(async function* () {
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

      const seen: number[] = [];
      for await (const n of api.counter.stream()) {
         seen.push(n);
         if (n === 2) {
            break;
         }
      }
      await settle();

      expect(seen).toStrictEqual([0, 1, 2]);
      expect(log).toStrictEqual(["finally"]);
   });

   it("stops the generator when the page cancels from an abort signal", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.tokens.handle(async function* () {
         try {
            for (let n = 0; ; n++) {
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
               await new Promise((resolve) => setTimeout(resolve, 1));
               yield `token ${n}`;
            }
         } finally {
            log.push("finally");
         }
      });
      const controller = new AbortController();
      const stream = api.tokens.stream("go");
      controller.signal.addEventListener("abort", () => stream.cancel(), { once: true });

      const first = await stream.next();
      controller.abort();
      await settle();

      expect(first).toStrictEqual({ done: false, value: "token 0" });
      expect(log).toStrictEqual(["finally"]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails the loop of the page with the error of the generator, after its chunks", async () => {
      const { ipc, api } = await loadBoth();
      ipc.tokens.handle(async function* () {
         yield "a";
         yield "b";
         throw Object.assign(new Error("exploded"), { name: "Boom", code: "E1", data: { n: 1 } });
      });

      const seen: string[] = [];
      let failure: unknown;
      try {
         for await (const token of api.tokens.stream("go")) {
            seen.push(token);
         }
      } catch (error) {
         failure = error;
      }

      expect(seen).toStrictEqual(["a", "b"]);
      expect(failure).toStrictEqual({
         name: "Boom",
         message: "exploded",
         code: "E1",
         data: { n: 1 },
      });
   });

   it("fails the stream with the unsendable code for a chunk that cannot be cloned", async () => {
      const { ipc, api } = await loadBoth();
      const log: string[] = [];
      ipc.tokens.handle(async function* () {
         try {
            yield "fine";
            yield () => 1;
            yield "never";
         } finally {
            log.push("finally");
         }
      });

      const stream = api.tokens.stream("go");

      expect(await stream.next()).toStrictEqual({ done: false, value: "fine" });
      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({ name: "IpcStreamError", code: "IPC_STREAM_UNSENDABLE" }),
      });
      await settle();
      expect(log).toStrictEqual(["finally"]);
   });

   it("fails the first read when the sender is rejected, with no stream made", async () => {
      const { ipc, api, frame } = await loadBoth();
      const handler = vi.fn(async function* () {});
      ipc.guarded.handle(handler);
      Object.assign(frame, { origin: "https://evil.example" });

      const stream = api.guarded.stream(3);

      expect(await settleRead(stream.next())).toStrictEqual({
         error: expect.objectContaining({ code: "IPC_FORBIDDEN" }),
      });
      expect(handler).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
   });

   it("fails the first read when the arguments are invalid", async () => {
      const { ipc, api } = await loadBoth();
      ipc.guarded.handle(async function* (_event: unknown, count: number) {
         yield count;
      });

      const bad = api.guarded.stream("three");
      const good = api.guarded.stream(3);

      expect(await settleRead(bad.next())).toStrictEqual({
         error: expect.objectContaining({ code: "IPC_VALIDATION" }),
      });
      expect(await good.next()).toStrictEqual({ done: false, value: 3 });
   });

   it("runs several streams of one channel at the same time", async () => {
      const { ipc, api } = await loadBoth();
      ipc.asForm.handle(async function* (_event: unknown, count: number) {
         for (let n = 0; n < count; n++) {
            // biome-ignore lint/performance/noAwaitInLoops: the generator produces a chunk at a time
            await new Promise((resolve) => setTimeout(resolve, 1));
            yield `${count}:${n}`;
         }
      });
      const read = async (count: number) => {
         const seen: string[] = [];
         for await (const chunk of api.asForm.stream(count)) {
            seen.push(chunk);
         }
         return seen;
      };

      const [two, three] = await Promise.all([read(2), read(3)]);

      expect(two).toStrictEqual(["2:0", "2:1"]);
      expect(three).toStrictEqual(["3:0", "3:1", "3:2"]);
   });
});
