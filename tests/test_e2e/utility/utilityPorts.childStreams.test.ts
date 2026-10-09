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
   cleanupUtilityPorts,
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

describe("utility ports, the utility process, streams", () => {
   it("pumps the chunks in order, then the end, and does not stop an iterator which ended", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      const handler = vi.fn(() => source.iterable);
      ipc.scanRows.handle(handler);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 5, "rows"));
      await flush();
      expect(handler).toHaveBeenCalledWith("rows");
      source.push({ id: 1 });
      source.push({ id: 2 });
      source.end();
      await flush();
      await flush();

      expect(port.postMessage.mock.calls.map(([message]) => message)).toStrictEqual([
         { __ipc: "chunk", channel: wire("scanRows"), id: 5, value: { id: 1 } },
         { __ipc: "chunk", channel: wire("scanRows"), id: 5, value: { id: 2 } },
         { __ipc: "end", channel: wire("scanRows"), id: 5 },
      ]);
      expect(source.iterator.return).not.toHaveBeenCalled();
   });

   it("serves an async generator, and several streams of one port by their IDs", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.counter.handle(async function* () {
         yield 1;
         yield 2;
      });
      const port = broker("counter");

      port.fromPage(startStream("counter", 1));
      port.fromPage(startStream("counter", 2));
      await settle();

      const byId = (id: number) => port.posted().filter((message) => message.id === id);
      for (const id of [1, 2]) {
         expect(byId(id).map((message) => message.__ipc)).toStrictEqual(["chunk", "chunk", "end"]);
         expect(byId(id).map((message) => message.value)).toStrictEqual([1, 2, undefined]);
      }
   });

   it("fails the stream with the error of the generator, and with the one of a handler which throws", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      ipc.counter.handle(() => {
         throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } };
      });
      const rows = broker("scanRows");
      const counter = broker("counter");

      rows.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      source.push({ id: 1 });
      source.fail(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
      counter.fromPage(startStream("counter", 2));
      await settle();

      expect(rows.posted().map((message) => message.__ipc)).toStrictEqual(["chunk", "error"]);
      expect(rows.posted("error")[0]).toStrictEqual({
         __ipc: "error",
         channel: wire("scanRows"),
         id: 1,
         error: { name: "Error", message: "disk full", code: "ENOSPC" },
      });
      expect(counter.posted("error")[0].error).toStrictEqual({
         name: "QueryError",
         message: "no table",
         code: "E_QUERY",
         data: { sql: "x" },
      });
   });

   it("fails a stream whose handler has no handler, returns no iterable, or rejects", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.scanRows.handle((() => ({ not: "iterable" })) as never);
      ipc.counter.handle((async () => {
         throw new Error("rejected");
      }) as never);
      const rows = broker("scanRows");
      const counter = broker("counter");
      const missing = broker("streamForm");
      // A call handler is not a stream handler.
      ipc.queryRows.handle(async () => []);
      const query = broker("queryRows");

      rows.fromPage(startStream("scanRows", 1, "rows"));
      counter.fromPage(startStream("counter", 2));
      missing.fromPage(startStream("streamForm", 3, "seed"));
      query.fromPage(startStream("queryRows", 4, "x"));
      await settle();

      expect(rows.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NOT_ITERABLE" });
      expect(counter.posted("error")[0].error).toMatchObject({ message: "rejected" });
      expect(missing.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NO_HANDLER" });
      expect(query.posted("error")[0].error).toMatchObject({ code: "IPC_UTILITY_NO_HANDLER" });
   });
});
