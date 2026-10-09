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

import { type E2EProject } from "@testutils/e2e-utils.js";
import { brokeredLoader } from "@testutils/serializer-brokered-utils.js";
import { AT, date, settle, settled } from "@testutils/serializer-wire-utils.js";
import { wire } from "@testutils/service-worker-utils.js";
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

describe("a page and a utility process over a brokered port, with a serializer", () => {
   it("delivers a call, with a Date and a Map in the result, as they were", async () => {
      const { utility, page, connect } = await loadBrokered();
      const seen: unknown[] = [];
      utility.lookup.handle(async (at: Date) => {
         seen.push(at);
         return new Map([["at", at]]);
      });
      connect("lookup");

      const found = await page.lookup.invoke(new Date(AT));

      expect(seen[0]).toBeInstanceOf(Date);
      expect(found).toBeInstanceOf(Map);
      expect((found.get("at") as Date).toISOString()).toBe(AT);
   });

   it("posts the call as a list of one serialized value, and reads the reply the same way", async () => {
      const { utility, holdChild } = await loadBrokered();
      utility.lookup.handle(async (at: Date) => new Map([["at", at]]));
      const pagePort = holdChild("lookup");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({
         __ipc: "call",
         channel: wire("lookup"),
         id: 5,
         args: [{ json: [date(AT)] }],
      });
      await settle();

      expect(received).toStrictEqual([
         {
            __ipc: "reply",
            channel: wire("lookup"),
            id: 5,
            envelope: {
               ok: true,
               value: { json: { $: "Map", v: [["at", date(AT)]] } },
            },
         },
      ]);
   });

   it("rejects a call with arguments that cannot be serialized at once, with the plain error, and posts nothing", async () => {
      const { utility, page, holdPage } = await loadBrokered();
      const handler = vi.fn(async () => new Map());
      utility.lookup.handle(handler);
      const childPort = holdPage("lookup");
      const received: unknown[] = [];
      childPort.onmessage = (event) => received.push(event.data);

      const outcome = await settled(page.lookup.invoke(() => undefined));
      await settle();

      expect(outcome.error).toStrictEqual({
         name: "IpcSerializationError",
         message:
            "The data cannot be serialized of the channel 'lookup': cannot serialize a function",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toStrictEqual([]);
      expect(handler).not.toHaveBeenCalled();
   });

   it("answers an unreadable call with the error envelope in the child", async () => {
      const { utility, holdChild } = await loadBrokered();
      const handler = vi.fn(async () => new Map());
      utility.lookup.handle(handler);
      const pagePort = holdChild("lookup");
      const received: Record<string, any>[] = [];
      pagePort.onmessage = (event) => received.push(event.data);

      pagePort.postMessage({ __ipc: "call", channel: wire("lookup"), id: 1, args: [new Date(AT)] });
      await settle();

      expect(handler).not.toHaveBeenCalled();
      expect(received[0].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
   });

   it("rejects the call of the page when the reply cannot be deserialized", async () => {
      const { page, holdPage } = await loadBrokered();
      const childPort = holdPage("lookup");
      childPort.onmessage = (event) =>
         childPort.postMessage({
            __ipc: "reply",
            channel: wire("lookup"),
            id: event.data.id,
            envelope: { ok: true, value: { json: { $: "Nope" } } },
         });

      const outcome = await settled(page.lookup.invoke(new Date(AT)));

      expect(outcome.error).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });
});
