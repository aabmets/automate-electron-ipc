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

import {
   abortNavigation,
   failLoading,
   finishLoading,
   startLoading,
   stopCommittedLoad,
} from "@testutils/e2e/runtime-utils.js";
import {
   channelsMade,
   cleanupUtilityPorts,
   createChild,
   createContents,
   loadMain,
} from "@testutils/e2e/utility-port-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, main process, ipc.<name>.connect", () => {
   it("pairs at once when the page has loaded: port1 to the child, port2 to the page, with one key", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();

      const link = ipc.queryRows.connect(child, { webContents: contents });

      expect(link).toStrictEqual({ close: expect.any(Function) });
      expect(channelsMade).toHaveLength(1);
      const [message, transfer] = child.postMessage.mock.calls[0];
      expect(message).toStrictEqual({
         __ipc: "port",
         channel: wire("queryRows"),
         key: expect.any(String),
      });
      expect(transfer).toStrictEqual([channelsMade[0].port1]);
      expect(contents.postMessage).toHaveBeenCalledWith(wire("queryRows"), message.key, [
         channelsMade[0].port2,
      ]);
   });

   it("accepts a window, a view and contents", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const [one, two, three] = [1, 2, 3].map((id) => createContents({ id }));

      ipc.queryRows.connect(child, { webContents: one });
      ipc.scanRows.connect(child, two);
      ipc.counter.connect(child, { webContents: three });

      expect(one.postMessage).toHaveBeenCalledTimes(1);
      expect(two.postMessage).toHaveBeenCalledTimes(1);
      expect(three.postMessage).toHaveBeenCalledTimes(1);
   });

   it("waits for the page to load, since an earlier port arrives before the preload script listens", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });

      ipc.queryRows.connect(child, contents);
      expect(channelsMade).toHaveLength(0);
      expect(child.postMessage).not.toHaveBeenCalled();

      finishLoading(contents);

      expect(channelsMade).toHaveLength(1);
      expect(child.postMessage).toHaveBeenCalledTimes(1);
      expect(contents.postMessage).toHaveBeenCalledTimes(1);
   });

   it("pairs again on every load with the same key, so that a page that reloads gets a fresh port", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);

      startLoading(contents);
      finishLoading(contents);

      expect(channelsMade).toHaveLength(2);
      const keys = child.postMessage.mock.calls.map(([message]) => message.key);
      expect(keys[1]).toBe(keys[0]);
      expect(contents.postMessage.mock.calls[1]).toStrictEqual([
         wire("queryRows"),
         keys[0],
         [channelsMade[1].port2],
      ]);
   });

   it("does not pair after a main frame fails to load", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });
      ipc.queryRows.connect(child, contents);

      startLoading(contents);
      contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://x", true);
      contents.loading = false;
      contents.emit("did-stop-loading");

      expect(channelsMade).toHaveLength(0);
   });

   it("does not pair the error page of a failed load, and pairs the next page that loads", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });
      ipc.queryRows.connect(child, contents);

      startLoading(contents);
      failLoading(contents);
      expect(channelsMade).toHaveLength(0);

      startLoading(contents);
      finishLoading(contents);
      expect(channelsMade).toHaveLength(1);
      expect(contents.postMessage).toHaveBeenCalledTimes(1);
   });

   it("pairs the document that committed when its load is stopped (ERR_ABORTED after a commit)", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents({ loading: true, url: "" });
      ipc.queryRows.connect(child, contents);
      expect(channelsMade).toHaveLength(0);

      startLoading(contents);
      stopCommittedLoad(contents);

      expect(channelsMade).toHaveLength(1);
      expect(contents.postMessage).toHaveBeenCalledTimes(1);
   });

   it("leaves the page alone when a navigation of it starts and stops without a commit", async () => {
      const ipc = await loadMain();
      const child = createChild();
      const contents = createContents();
      ipc.queryRows.connect(child, contents);
      expect(channelsMade).toHaveLength(1);

      abortNavigation(contents);

      expect(channelsMade).toHaveLength(1);
      expect(child.postMessage).toHaveBeenCalledTimes(1);
      expect(contents.postMessage).toHaveBeenCalledTimes(1);
   });
});
