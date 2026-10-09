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

import { cleanupUtilityPorts, loadPage, settled } from "@testutils/e2e/utility-port-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the page, streams", () => {
   const chunk = (name: string, id: number, value: unknown) => ({
      __ipc: "chunk",
      channel: wire(name),
      id,
      value,
   });
   const end = (name: string, id: number) => ({ __ipc: "end", channel: wire(name), id });
   const failure = (name: string, id: number, error: unknown) => ({
      __ipc: "error",
      channel: wire(name),
      id,
      error,
   });

   it("waits for the port, posts the start with the arguments, and reads the chunks in order", async () => {
      const { api, arrive } = await loadPage();

      const stream = api.scanRows.stream("rows");
      const port = arrive("scanRows");

      const [start] = port.posted("stream");
      expect(start).toStrictEqual({
         __ipc: "stream",
         channel: wire("scanRows"),
         id: expect.any(Number),
         args: ["rows"],
      });
      const reads = [stream.next(), stream.next(), stream.next()];
      port.deliver(chunk("scanRows", start.id, { id: 1 }));
      port.deliver(chunk("scanRows", start.id, { id: 2 }));
      port.deliver(end("scanRows", start.id));
      expect(await Promise.all(reads)).toStrictEqual([
         { done: false, value: { id: 1 } },
         { done: false, value: { id: 2 } },
         { done: true, value: undefined },
      ]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("is an async iterable, and keeps the streams of one port apart by their IDs", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("counter");
      const one = api.counter.stream();
      const two = api.counter.stream();
      const [first, second] = port.posted("stream");

      port.deliver(chunk("counter", second.id, "b"));
      port.deliver(chunk("counter", first.id, "a"));
      port.deliver(end("counter", first.id));
      port.deliver(end("counter", second.id));

      const read = async (stream: AsyncIterable<unknown>) => {
         const chunks: unknown[] = [];
         for await (const item of stream) {
            chunks.push(item);
         }
         return chunks;
      };
      expect(await read(one)).toStrictEqual(["a"]);
      expect(await read(two)).toStrictEqual(["b"]);
   });

   it("fails a read with the error of the stream, as a plain object, after the chunks that were queued", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");

      port.deliver(chunk("scanRows", start.id, 1));
      port.deliver(
         failure("scanRows", start.id, {
            name: "QueryError",
            message: "no table",
            code: "E_QUERY",
            data: { sql: "x" },
         }),
      );

      expect(await stream.next()).toStrictEqual({ done: false, value: 1 });
      expect(await settled(stream.next())).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("cancels in the child with the ID, drops what was queued, and ends the stream", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");
      port.deliver(chunk("scanRows", start.id, 1));

      stream.cancel();
      stream.cancel();
      port.deliver(chunk("scanRows", start.id, 2));

      expect(port.posted("cancel")).toStrictEqual([
         { __ipc: "cancel", channel: wire("scanRows"), id: start.id },
      ]);
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("cancels with return(), which a break calls, and does not touch the other streams", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("counter");
      const one = api.counter.stream();
      const two = api.counter.stream();
      const [first, second] = port.posted("stream");

      expect(await one.return()).toStrictEqual({ done: true, value: undefined });

      expect(port.posted("cancel").map((message) => message.id)).toStrictEqual([first.id]);
      port.deliver(chunk("counter", second.id, 5));
      expect(await two.next()).toStrictEqual({ done: false, value: 5 });
   });

   it("never starts a stream which is cancelled while it waits for the port", async () => {
      const { api, arrive } = await loadPage();
      const stream = api.scanRows.stream("rows");

      stream.cancel();
      const port = arrive("scanRows");

      expect(port.postMessage).not.toHaveBeenCalled();
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails the streams that are open when the port closes, with IPC_UTILITY_EXITED", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");

      port.emitClose();

      expect(await settled(stream.next())).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
      });
      expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
   });

   it("fails a stream which is started after the connection closed, at the first read", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      port.emitClose();

      const stream = api.scanRows.stream("rows");

      expect(await settled(stream.next())).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(port.posted("stream")).toHaveLength(0);
   });

   it("fails the stream when its start cannot be sent", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      const stream = api.scanRows.stream("rows");

      const result = await settled(stream.next());
      expect(result).toMatchObject({ error: { code: "IPC_UTILITY_UNSENDABLE" } });
      expect((result as { error: Error }).error.message).toContain("could not be cloned");
   });

   it("ignores messages for another channel, another ID or of an unknown shape", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("scanRows");
      const stream = api.scanRows.stream("rows");
      const [start] = port.posted("stream");

      for (const message of [
         null,
         "text",
         chunk("counter", start.id, "other channel"),
         chunk("scanRows", start.id + 100, "other id"),
         { __ipc: "unknown", channel: wire("scanRows"), id: start.id },
      ]) {
         port.deliver(message);
      }
      port.deliver(chunk("scanRows", start.id, "mine"));

      expect(await stream.next()).toStrictEqual({ done: false, value: "mine" });
   });
});
