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

import { createSource } from "@testutils/runtime-utils.js";
import {
   cancel,
   cleanupUtilityPorts,
   flush,
   loadUtility,
   settle,
   startStream,
} from "@testutils/utility-port-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the utility process, streams", () => {
   it("stops the iterator once when the page cancels, and sends no chunk after it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      source.push({ id: 1 });
      await flush();

      port.fromPage(cancel("scanRows", 1));
      port.fromPage(cancel("scanRows", 1));
      port.fromPage(cancel("scanRows", 99));
      source.push({ id: 2 });
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(port.posted("chunk")).toHaveLength(1);
      expect(port.posted("error")).toHaveLength(0);
   });

   it("says nothing about an error which arrives after the cancel", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();

      port.fromPage(cancel("scanRows", 1));
      source.fail(new Error("late"));
      await settle();

      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops a stream which is cancelled while the handler is starting, without reading it", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (open = resolve));
      ipc.scanRows.handle((async () => {
         await gate;
         return source.iterable;
      }) as never);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.fromPage(cancel("scanRows", 1));
      open();
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(source.iterator.next).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("says nothing about an error of a handler which was cancelled while it started", async () => {
      const { ipc, broker } = await loadUtility();
      let reject: (error: unknown) => void = () => undefined;
      const gate = new Promise<never>((_resolve, fail) => (reject = fail));
      ipc.scanRows.handle((async () => gate) as never);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.fromPage(cancel("scanRows", 1));
      reject(new Error("late"));
      await settle();

      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops every open stream when the port closes, and sends nothing afterwards", async () => {
      const { ipc, broker } = await loadUtility();
      const rows = createSource();
      const counter = createSource();
      ipc.scanRows.handle(() => rows.iterable);
      ipc.counter.handle(() => counter.iterable as never);
      const port = broker("scanRows");
      const other = broker("counter");
      port.fromPage(startStream("scanRows", 1, "rows"));
      port.fromPage(startStream("scanRows", 2, "rows"));
      other.fromPage(startStream("counter", 1));
      await flush();

      port.emit("close");
      rows.push({ id: 1 });
      rows.push({ id: 2 });
      await settle();

      // Both streams of the port read from the same source here, so the one stop each is enough.
      expect(rows.iterator.return).toHaveBeenCalledTimes(2);
      expect(counter.iterator.return).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("stops the iterator and fails the stream when a chunk cannot be sent", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      source.push(() => undefined);
      await settle();

      expect(source.iterator.return).toHaveBeenCalledTimes(1);
      expect(port.posted("error")[0].error).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_UNSENDABLE",
      });
      expect(port.posted("error")[0].error.message).toContain("could not be cloned");
   });

   it("ignores a second start with the ID of a stream which is open", async () => {
      const { ipc, broker } = await loadUtility();
      const source = createSource();
      const handler = vi.fn(() => source.iterable);
      ipc.scanRows.handle(handler);
      const port = broker("scanRows");

      port.fromPage(startStream("scanRows", 1, "rows"));
      port.fromPage(startStream("scanRows", 1, "again"));
      await flush();

      expect(handler).toHaveBeenCalledTimes(1);
   });

   it("reports what cannot be told to the page, instead of throwing", async () => {
      const { ipc, broker } = await loadUtility();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const ending = createSource();
      const failing = createSource();
      const stopping = createSource();
      stopping.iterator.return.mockRejectedValue(new Error("return failed"));
      ipc.scanRows.handle(() => ending.iterable);
      ipc.counter.handle(() => failing.iterable as never);
      ipc.streamForm.handle(() => stopping.iterable as never);
      const rows = broker("scanRows");
      const counter = broker("counter");
      const form = broker("streamForm");
      rows.postMessage.mockImplementation(() => {
         throw new Error("port is gone");
      });
      counter.postMessage.mockImplementation(() => {
         throw new Error("port is gone");
      });
      rows.fromPage(startStream("scanRows", 1, "rows"));
      counter.fromPage(startStream("counter", 1));
      form.fromPage(startStream("streamForm", 1, "seed"));
      await flush();

      ending.end();
      failing.fail(new Error("broken"));
      form.fromPage(cancel("streamForm", 1));
      await settle();

      const messages = error.mock.calls.map(([value]) => (value as Error).message);
      expect(messages.filter((message) => message === "port is gone")).toHaveLength(2);
      expect(messages).toContain("return failed");
   });

   it("reports an iterator which cannot be stopped, and a failing stop of a closed port", async () => {
      const { ipc, broker } = await loadUtility();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const source = createSource();
      source.iterator.return.mockImplementation(() => {
         throw new Error("return threw");
      });
      ipc.scanRows.handle(() => source.iterable);
      const port = broker("scanRows");
      port.fromPage(startStream("scanRows", 1, "rows"));
      await flush();

      port.emit("close");

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "return threw" }));
   });
});
