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

import { createContents } from "@testutils/e2e/fake-contents.js";
import { channelsMade } from "@testutils/e2e/fake-ports.js";
import { createChild } from "@testutils/e2e/fake-utility.js";
import { finishLoading, startLoading } from "@testutils/e2e/runtime-utils.js";
import { cleanupUtilityPorts, loadMain } from "@testutils/e2e/utility-port-utils.js";
import { closeWire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupUtilityPorts();
});

type FakeContents = ReturnType<typeof createContents>;

/** Destroys contents the way Electron does: they emit `destroyed` once they cannot be used. */
function destroy(contents: FakeContents) {
   contents.destroyed = true;
   contents.emit("destroyed");
}

/** The events that `connect` listens to on the contents of a page, to tell when it has loaded. */
const loadEvents = ["did-navigate", "did-fail-load", "did-finish-load", "did-stop-loading"];

describe("utility ports, main process, ipc.<name>.connect", () => {
   it("ends the connection with close: the page is told with the key, and nothing is paired later", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      const link = ipc.queryRows.connect(child, contents);
      const key = child.postMessage.mock.calls[0][0].key;

      link.close();
      link.close();

      expect(contents.send).toHaveBeenCalledTimes(1);
      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), key);
      expect(child.listenerCount("exit")).toBe(1); // only that of attachUtility is left
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("did-finish-load")).toBe(0);
      startLoading(contents);
      finishLoading(contents);
      expect(channelsMade).toHaveLength(1);
   });

   // Node warns about more than ten listeners of one event (T87).
   it("adds one 'exit' listener to the child and one 'destroyed' listener to each page, however many connections", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const pages = Array.from({ length: 12 }, (_, id) => createContents({ id: id + 1 }));
      const links = pages.map((page) => ipc.queryRows.connect(child, page));

      // The one of attachUtility, and the one that the connections share.
      expect(child.listenerCount("exit")).toBe(2);
      for (const page of pages) {
         expect(page.listenerCount("destroyed")).toBe(1);
         for (const event of loadEvents) {
            expect(page.listenerCount(event)).toBe(1);
         }
      }

      // Closing all but one of them keeps the shared listener for the one that is left.
      for (const link of links.slice(0, 11)) {
         link.close();
      }
      expect(child.listenerCount("exit")).toBe(2);
      child.emit("exit", 1);
      expect(pages[11].send).toHaveBeenCalledWith(closeWire("queryRows"), expect.any(String));
      expect(pages[11].listenerCount("destroyed")).toBe(0);

      const { child: lone } = createChild();
      const connection = ipc.queryRows.connect(lone, createContents());
      connection.close();
      expect(lone.listenerCount("exit")).toBe(1);
   });

   it("connects many channels of one page with one listener for each event", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();

      const links = [
         ipc.queryRows.connect(child, contents),
         ipc.scanRows.connect(child, contents),
         ipc.counter.connect(child, contents),
      ];

      expect(contents.listenerCount("destroyed")).toBe(1);
      for (const event of loadEvents) {
         expect(contents.listenerCount(event)).toBe(1);
      }
      for (const link of links) {
         link.close();
      }
      expect(contents.listenerCount("destroyed")).toBe(0);
      for (const event of loadEvents) {
         expect(contents.listenerCount(event)).toBe(0);
      }
   });

   it("ends the connection when the child exits", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);
      const key = child.postMessage.mock.calls[0][0].key;

      child.emit("exit", 1);

      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), key);
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("ends the connection when the contents are destroyed, without touching them", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);

      destroy(contents);

      expect(contents.send).not.toHaveBeenCalled();
      expect(child.listenerCount("exit")).toBe(1); // only that of attachUtility is left
   });

   it("replaces the connection of the same channel and page, which cannot fight for the port on a reload", async () => {
      const ipc = await loadMain();
      const { child: first } = createChild();
      const { child: second } = createChild();
      const contents = createContents();
      ipc.queryRows.connect(first, contents);
      const oldKey = first.postMessage.mock.calls[0][0].key;

      ipc.queryRows.connect(second, contents);

      const newKey = second.postMessage.mock.calls[0][0].key;
      expect(newKey).not.toBe(oldKey);
      expect(contents.send).toHaveBeenCalledWith(closeWire("queryRows"), oldKey);
      expect(first.listenerCount("exit")).toBe(1); // only that of attachUtility is left
      startLoading(contents);
      finishLoading(contents);
      expect(first.postMessage).toHaveBeenCalledTimes(1);
      expect(second.postMessage).toHaveBeenCalledTimes(2);
   });

   it("keeps the connections of other channels and other pages apart", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const page = createContents({ id: 1 });
      const other = createContents({ id: 2 });
      const query = ipc.queryRows.connect(child, page);
      ipc.countRows.connect(child, page);
      ipc.queryRows.connect(child, other);

      expect(page.send).not.toHaveBeenCalled();
      expect(other.send).not.toHaveBeenCalled();
      query.close();

      expect(page.send).toHaveBeenCalledTimes(1);
      expect(other.send).not.toHaveBeenCalled();
      startLoading(page);
      finishLoading(page);
      expect(page.postMessage).toHaveBeenCalledTimes(3);
   });

   it("throws for contents which are destroyed already, and registers nothing", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      contents.destroyed = true;

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("Object has been destroyed");

      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(child.listenerCount("exit")).toBe(1); // only that of attachUtility is left
      expect(child.postMessage).not.toHaveBeenCalled();
   });

   it("throws IPC_UTILITY_NOT_ATTACHED for a child that was never attached, and registers nothing (T86)", async () => {
      const ipc = await loadMain();
      const { child } = createChild({ attached: false });
      const contents = createContents();

      expect(() => ipc.queryRows.connect(child, contents)).toThrow(
         expect.objectContaining({
            name: "IpcUtilityError",
            code: "IPC_UTILITY_NOT_ATTACHED",
            channel: "autoipc:queryRows",
            message: expect.stringContaining("forkUtility()"),
         }),
      );

      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("did-finish-load")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(child.postMessage).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(0);
   });

   it("throws IPC_UTILITY_EXITED for a child that exited, registers nothing and keeps the earlier connection of the page (T86)", async () => {
      const ipc = await loadMain();
      const { child: other } = createChild();
      const { child } = createChild();
      const contents = createContents();
      ipc.queryRows.connect(other, contents);
      child.emit("exit", 1);
      contents.send.mockClear();

      expect(() => ipc.queryRows.connect(child, contents)).toThrow(
         expect.objectContaining({
            name: "IpcUtilityError",
            code: "IPC_UTILITY_EXITED",
            channel: "autoipc:queryRows",
         }),
      );

      // The page keeps the connection it had: it was not closed for a connection that failed.
      expect(contents.send).not.toHaveBeenCalled();
      expect(child.postMessage).not.toHaveBeenCalled();
      expect(channelsMade).toHaveLength(1);
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("undoes the connection and closes both ports when the first pairing fails", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("the child is gone");
      });
      const contents = createContents();

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("the child is gone");

      expect(channelsMade[0].port1.close).toHaveBeenCalledTimes(1);
      expect(channelsMade[0].port2.close).toHaveBeenCalledTimes(1);
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(child.listenerCount("exit")).toBe(1); // only that of attachUtility is left
      expect(contents.listenerCount("did-finish-load")).toBe(0);
   });

   it("closes the ports when the page cannot be reached", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      contents.postMessage.mockImplementation(() => {
         throw new Error("no frame");
      });

      expect(() => ipc.queryRows.connect(child, contents)).toThrow("no frame");

      expect(channelsMade[0].port1.close).toHaveBeenCalledTimes(1);
   });

   it("reports a pairing which fails on a later load, instead of throwing from the event", async () => {
      const ipc = await loadMain();
      const { child } = createChild();
      const contents = createContents();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      ipc.queryRows.connect(child, contents);
      child.postMessage.mockImplementation(() => {
         throw new Error("the child is gone");
      });

      startLoading(contents);
      expect(() => finishLoading(contents)).not.toThrow();

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "the child is gone" }));
   });
});
