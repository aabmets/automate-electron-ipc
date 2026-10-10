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

import { createContents } from "@testutils/e2e/fake-contents.js";
import { channelsMade, lastPort } from "@testutils/e2e/fake-ports.js";
import {
   cleanupMainPorts,
   fromPage,
   loadMain,
   loadMainWithElectron,
} from "@testutils/e2e/main-port-utils.js";
import { finishLoading } from "@testutils/e2e/runtime-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupMainPorts();
});

describe("ipc.<name>.connect of a mainPort channel", () => {
   it("pairs at once when the page has loaded, keeps port1 and posts port2 with the key", async () => {
      const ipc = await loadMain();
      const contents = createContents();

      ipc.logTail.connect({ webContents: contents });

      expect(channelsMade).toHaveLength(1);
      expect(lastPort().start).toHaveBeenCalledOnce();
      expect(contents.postMessage).toHaveBeenCalledExactlyOnceWith(wire("logTail"), "1:main", [
         channelsMade[0].port2,
      ]);
   });

   it("takes a window, a view and contents alike", async () => {
      const ipc = await loadMain();
      const [a, b, c] = [createContents(), createContents(), createContents()];

      ipc.logTail.connect({ webContents: a });
      ipc.logTail.connect({ webContents: b });
      ipc.logTail.connect(c);

      for (const contents of [a, b, c]) {
         expect(contents.postMessage).toHaveBeenCalledOnce();
      }
   });

   it("posts nothing until the page has loaded, then pairs on the load", async () => {
      const ipc = await loadMain();
      const contents = createContents({ loading: true });

      ipc.logTail.connect(contents);
      expect(channelsMade).toHaveLength(0);
      expect(contents.postMessage).not.toHaveBeenCalled();

      finishLoading(contents);

      expect(contents.postMessage).toHaveBeenCalledOnce();
      expect(channelsMade).toHaveLength(1);
   });

   it("treats contents without a page as not loaded", async () => {
      const ipc = await loadMain();
      const blank = createContents({ url: "" });

      ipc.logTail.connect(blank);

      expect(blank.postMessage).not.toHaveBeenCalled();
   });

   it("gives every connection its own key, also for the same contents", async () => {
      const ipc = await loadMain();
      const contents = createContents();

      ipc.logTail.connect(contents);
      ipc.logTail.connect(contents);

      const keys = contents.postMessage.mock.calls.map(([, key]) => key);
      expect(keys).toStrictEqual(["1:main", "2:main"]);
   });

   it("uses the channel prefix of the config for the name that Electron sees", async () => {
      const { ipc } = await loadMainWithElectron();
      const contents = createContents();

      ipc.logTail.connect(contents);

      expect(contents.postMessage.mock.calls[0][0]).toBe("autoipc:logTail");
   });

   describe("a page which reloads", () => {
      // A port that was posted once was lost when the page loaded again.
      it("gets a fresh port on every load, and the old port is closed", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         ipc.logTail.connect(contents);
         const first = lastPort();

         contents.emit("did-finish-load");

         expect(channelsMade).toHaveLength(2);
         expect(first.close).toHaveBeenCalledOnce();
         expect(lastPort().start).toHaveBeenCalledOnce();
         // The same key, so the page knows it is the same connection.
         expect(contents.postMessage.mock.calls.map(([, key]) => key)).toStrictEqual([
            "1:main",
            "1:main",
         ]);
      });

      it("does not tell the onClose subscribers about the replaced port, but runs onReady again", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onReady = vi.fn();
         const onClose = vi.fn();
         connection.onReady(onReady);
         connection.onClose(onClose);
         const first = lastPort();

         contents.emit("did-finish-load");
         // The old port closes later, and the connection is not over.
         first.emit("close");

         expect(onReady).toHaveBeenCalledTimes(2);
         expect(onClose).not.toHaveBeenCalled();
      });

      it("hears only the port that is current", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const heard = vi.fn();
         connection.on(heard);
         const first = lastPort();

         contents.emit("did-finish-load");
         fromPage(first, ["stale"]);
         fromPage(lastPort(), ["fresh"]);

         expect(heard.mock.calls).toStrictEqual([["fresh"]]);
      });
   });
});
