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

import { cleanupMainPorts, loadBoth } from "@testutils/e2e/main-port-utils.js";
import { finishLoading } from "@testutils/e2e/runtime-utils.js";
import { settle } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupMainPorts();
});

describe("a main process and a page over a real message channel", () => {
   it("sends in both directions, and queues until the page is connected", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      contents.loading = true;
      const connection = mainIpc.logTail.connect(contents);
      const fromMain: unknown[][] = [];
      const fromPage: unknown[][] = [];
      page.on((...args: unknown[]) => fromMain.push(args));
      connection.on((...args: unknown[]) => fromPage.push(args));

      connection.send("queued by main", 1);
      page.send("queued by page");
      finishLoading(contents);
      connection.send("live from main");
      page.send("live from page", 2);
      await settle();

      expect(fromMain).toStrictEqual([["queued by main", 1], ["live from main"]]);
      expect(fromPage).toStrictEqual([["queued by page"], ["live from page", 2]]);
   });

   it("shows the page the connection as one peer, which can answer on its own", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const answers: unknown[][] = [];
      connection.on((...args: unknown[]) => answers.push(args));
      page.onConnection((peer: { on: Function; send: Function }) => {
         peer.on((line: string) => peer.send(`echo ${line}`));
      });
      const echoed: unknown[][] = [];
      connection.on((...args: unknown[]) => echoed.push(args));

      connection.send("ping");
      await settle();

      expect(answers).toStrictEqual([["echo ping"]]);
      expect(echoed).toStrictEqual(answers);
   });

   it("keeps the connection through a reload of the page, with a new port", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const onReady = vi.fn();
      const heardByPage: unknown[][] = [];
      const heardByMain: unknown[][] = [];
      connection.onReady(onReady);
      page.on((...args: unknown[]) => heardByPage.push(args));
      connection.on((...args: unknown[]) => heardByMain.push(args));

      contents.emit("did-finish-load");
      connection.send("after reload");
      page.send("from the page");
      await settle();

      expect(onReady).toHaveBeenCalledTimes(2);
      expect(heardByPage).toStrictEqual([["after reload"]]);
      expect(heardByMain).toStrictEqual([["from the page"]]);
   });

   it("ends for the page when main closes the connection", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const pageClosed = vi.fn();
      page.onClose(pageClosed);
      const heard = vi.fn();
      page.on(heard);

      connection.close();
      connection.send("too late");
      await settle();

      expect(pageClosed).toHaveBeenCalledOnce();
      expect(heard).not.toHaveBeenCalled();
   });

   it("ends for main when the page closes the connection", async () => {
      const { mainIpc, contents, page } = await loadBoth();
      const connection = mainIpc.logTail.connect(contents);
      const mainClosed = vi.fn();
      connection.onClose(mainClosed);
      const peers: { close: () => void }[] = [];
      page.onConnection((peer: { close: () => void }) => peers.push(peer));

      peers[0].close();
      await settle();

      expect(mainClosed).toHaveBeenCalledOnce();
      // The connection is over, so a reload does not pair it again.
      contents.emit("did-finish-load");
      expect(contents.postMessage).toHaveBeenCalledOnce();
   });
});
