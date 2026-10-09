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

import { finishLoading, startLoading } from "@testutils/runtime-utils.js";
import { cleanupUtilityPorts, loadAll, settle, settled } from "@testutils/utility-port-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the three scripts together over real ports", () => {
   it("calls the handler of the child from the page, with the errors of the handler", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.queryRows.handle(async (sql: string, limit?: number) => {
         if (sql === "bad") {
            throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql } };
         }
         return [{ id: sql.length, label: String(limit) }];
      });
      main.queryRows.connect(child, contents);

      expect(await page.queryRows.invoke("select", 2)).toStrictEqual([{ id: 6, label: "2" }]);
      expect(await settled(page.queryRows.invoke("bad"))).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "bad" } },
      });
   });

   it("holds a call which is made before the main process connects, and sends it afterwards", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.countRows.handle((table: string) => table.length);

      const early = page.countRows.invoke("rows");
      await settle();
      main.countRows.connect(child, contents);

      expect(await early).toBe(4);
   });

   it("streams from the child to the page, and cancels it", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let stopped = 0;
      utility.scanRows.handle(async function* (table: string) {
         try {
            for (let id = 1; ; id++) {
               yield { id, label: `${table}-${id}` };
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a row at a time
               await settle();
            }
         } finally {
            stopped += 1;
         }
      });
      utility.counter.handle(async function* () {
         yield 1;
         yield 2;
      });
      main.scanRows.connect(child, contents);
      main.counter.connect(child, contents);

      const rows: unknown[] = [];
      for await (const row of page.scanRows.stream("t")) {
         rows.push(row);
         if (rows.length === 2) {
            break;
         }
      }
      await settle();
      const counted: number[] = [];
      for await (const value of page.counter.stream()) {
         counted.push(value);
      }

      expect(rows).toStrictEqual([
         { id: 1, label: "t-1" },
         { id: 2, label: "t-2" },
      ]);
      expect(stopped).toBe(1);
      expect(counted).toStrictEqual([1, 2]);
   });

   it("fails the page when the main process closes the connection, and the child stops the stream", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let stopped = 0;
      utility.scanRows.handle(async function* () {
         try {
            for (;;) {
               yield 1;
               // biome-ignore lint/performance/noAwaitInLoops: the generator produces a value at a time
               await settle();
            }
         } finally {
            stopped += 1;
         }
      });
      const link = main.scanRows.connect(child, contents);
      const stream = page.scanRows.stream("t");
      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });

      link.close();

      expect(await settled(stream.next())).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      await settle();
      expect(stopped).toBe(1);
      expect(await settled(page.scanRows.stream("t").next())).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });
   });

   it("gives a page that reloads a fresh port, and keeps the child's handlers", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      utility.countRows.handle((table: string) => table.length);
      main.countRows.connect(child, contents);
      expect(await page.countRows.invoke("rows")).toBe(4);

      startLoading(contents);
      finishLoading(contents);

      expect(await page.countRows.invoke("rows!")).toBe(5);
   });
});

describe("utility ports, the three scripts together, flow control", () => {
   it("keeps a fast generator in the child within the window of a reader which stopped reading", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      const state = { produced: 0, finalized: false };
      utility.windowedRows.handle(async function* () {
         try {
            for (;;) {
               state.produced += 1;
               yield state.produced;
            }
         } finally {
            state.finalized = true;
         }
      });
      main.windowedRows.connect(child, contents);

      const stream = page.windowedRows.stream();
      for (let read = 0; read < 3; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         await stream.next();
      }
      await settle();
      await settle();

      expect(state.produced).toBeGreaterThanOrEqual(4);
      expect(state.produced).toBeLessThanOrEqual(3 + 4);
      const paused = state.produced;
      await settle();
      expect(state.produced).toBe(paused);

      stream.cancel();
      await settle();
      expect(state.finalized).toBe(true);
   });

   it("reads every chunk in order through many pauses, and produces a chunk at a time when the window is 0", async () => {
      const { main, utility, page, child, contents } = await loadAll();
      let produced = 0;
      utility.windowedRows.handle(async function* () {
         for (let n = 0; n < 200; n++) {
            yield n;
         }
      });
      utility.pulledRows.handle(async function* () {
         for (;;) {
            produced += 1;
            yield produced;
         }
      });
      main.windowedRows.connect(child, contents);
      main.pulledRows.connect(child, contents);

      const seen: number[] = [];
      for await (const n of page.windowedRows.stream()) {
         seen.push(n);
      }
      const pulled = page.pulledRows.stream();
      for (let read = 1; read <= 4; read++) {
         // biome-ignore lint/performance/noAwaitInLoops: the reads are made one after the other
         expect(await pulled.next()).toStrictEqual({ done: false, value: read });
         await settle();
         expect(produced).toBe(read);
      }
      pulled.cancel();

      expect(seen).toStrictEqual(Array.from({ length: 200 }, (_, n) => n));
   });
});
