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

import { brokeredLoader } from "@testutils/e2e/serializer-brokered-utils.js";
import { AT, date, settled } from "@testutils/e2e/serializer-wire-utils.js";
import { settle, wire } from "@testutils/e2e/wire-utils.js";
import { type E2EProject } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;
const rawPorts: MessagePort[] = [];

afterEach(async () => {
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
});

const loadBrokered = brokeredLoader((created) => {
   project = created;
}, rawPorts);

const EPOCH = "1970-01-01T00:00:00.000Z";

describe("a page and a utility process over a brokered port, with a serializer", () => {
   it("streams Dates from the child, serializing the arguments and each chunk", async () => {
      const { utility, page, connect } = await loadBrokered();
      const seen: unknown[] = [];
      utility.dates.handle(async function* (since: Date) {
         seen.push(since);
         yield since;
         yield new Date(0);
      });
      connect("dates");

      const dates: Date[] = [];
      for await (const at of page.dates.stream(new Date(AT))) {
         dates.push(at);
      }

      expect(seen[0]).toBeInstanceOf(Date);
      expect(dates.map((at) => at.toISOString())).toStrictEqual([AT, EPOCH]);
   });

   it("posts the stream and its chunks in the wire shape", async () => {
      const { utility, holdChild } = await loadBrokered();
      utility.dates.handle(async function* (since: Date) {
         yield since;
      });
      const pagePort = holdChild("dates");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "stream",
         channel: wire("dates"),
         id: 3,
         args: [{ json: [date(AT)] }],
      });
      await settle();

      expect(received.map((message) => message.__ipc)).toStrictEqual(["chunk", "end"]);
      expect(received[0].value).toStrictEqual({ json: date(AT) });
   });

   it("fails a stream whose arguments cannot be read, before the first chunk", async () => {
      const { utility, holdChild } = await loadBrokered();
      const handler = vi.fn(async function* () {
         yield new Date(0);
      });
      utility.dates.handle(handler);
      const pagePort = holdChild("dates");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "stream",
         channel: wire("dates"),
         id: 3,
         args: [new Date(AT)],
      });
      await settle();

      expect(handler).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
         __ipc: "error",
         id: 3,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
   });

   it("fails a stream with the error when a chunk cannot be serialized, and stops the generator", async () => {
      const { utility, page, connect } = await loadBrokered();
      let finished = 0;
      utility.dates.handle(async function* () {
         try {
            yield new Date(0);
            yield (() => undefined) as unknown as Date;
            yield new Date(1);
         } finally {
            finished += 1;
         }
      });
      connect("dates");

      const stream = page.dates.stream(new Date(AT));
      expect(((await stream.next()).value as Date).getTime()).toBe(0);
      const outcome = await settled(stream.next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(finished).toBe(1);
   });

   it("fails a stream of the page with the plain error when the arguments cannot be serialized", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("dates");
      const received: unknown[] = [];
      childPort.onmessage = (event) => received.push(event.data);

      const outcome = await settled(page.dates.stream(() => undefined).next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toStrictEqual([]);
   });

   it("fails a stream of the page when a chunk cannot be deserialized, and cancels it in the child", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("dates");
      const received: Record<string, any>[] = [];
      childPort.onmessage = (event) => {
         received.push(event.data);
         if (event.data.__ipc === "stream") {
            childPort.postMessage({
               __ipc: "chunk",
               channel: wire("dates"),
               id: event.data.id,
               value: { json: { $: "Nope" } },
            });
         }
      };

      const outcome = await settled(page.dates.stream(new Date(AT)).next());
      await settle();

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(received.map((message) => message.__ipc)).toContain("cancel");
   });
});
