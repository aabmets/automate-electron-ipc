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
import {
   channelsMade,
   FakeChannelMain,
   FakePagePort,
   FakePortMain,
   lastPort,
} from "@testutils/e2e/fake-ports.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("the fake web contents", () => {
   it("report their state, which a test can change", () => {
      const contents = createContents({ id: 7, loading: true, url: "app://x" });

      expect([contents.id, contents.isLoading(), contents.getURL()]).toStrictEqual([
         7,
         true,
         "app://x",
      ]);
      contents.loading = false;
      contents.crashed = true;
      expect([contents.isLoading(), contents.isCrashed(), contents.isDestroyed()]).toStrictEqual([
         false,
         true,
         false,
      ]);
   });

   it("announce their end like Electron does, and refuse to send once it came", () => {
      const contents = createContents();
      const ended = vi.fn();
      contents.on("destroyed", ended);
      contents.send("a", 1);
      contents.postMessage("b", null, []);

      contents.destroy();

      expect(ended).toHaveBeenCalledOnce();
      expect(contents.isDestroyed()).toBe(true);
      expect(() => contents.send("a")).toThrowError("Object has been destroyed");
      expect(() => contents.postMessage("b", null, [])).toThrowError("Object has been destroyed");
      // The attempt is recorded, like the ones before it.
      expect(contents.send.mock.calls).toStrictEqual([["a", 1], ["a"]]);
   });

   it("can start out destroyed", () => {
      expect(() => createContents({ destroyed: true }).send("a")).toThrowError(/destroyed/);
   });
});

describe("the fake ports of the main process", () => {
   beforeEach(() => {
      channelsMade.length = 0;
   });

   it("record the channels that were made, with ports that are named after them", () => {
      const first = new FakeChannelMain();
      const second = new FakeChannelMain();

      expect(channelsMade).toStrictEqual([first, second]);
      expect([second.port1.name, second.port2.name]).toStrictEqual(["port1 of 2", "port2 of 2"]);
      expect(lastPort()).toBe(second.port1);
   });

   it("report a message of the page as { data }, and list what they posted by tag", () => {
      const port = new FakePortMain();
      const received = vi.fn();
      port.on("message", received);
      port.postMessage({ __ipc: "credit", n: 1 });
      port.postMessage({ __ipc: "done" });

      port.fromPage("hello");

      expect(received).toHaveBeenCalledWith({ data: "hello" });
      expect(port.posted("credit")).toStrictEqual([{ __ipc: "credit", n: 1 }]);
      expect(port.posted()).toHaveLength(2);
   });
});

describe("the fake port of a page", () => {
   it("delivers a message to onmessage, tells about the close, and lists what it posted", () => {
      const port = new FakePagePort();
      const received = vi.fn();
      const closed = vi.fn();
      port.onmessage = received;
      port.addEventListener("close", closed);
      port.addEventListener("message", closed);
      port.postMessage({ __ipc: "cancel" });

      port.deliver("from main");
      port.emitClose();

      expect(received).toHaveBeenCalledWith({ data: "from main" });
      expect(closed).toHaveBeenCalledOnce();
      expect(port.posted("cancel")).toStrictEqual([{ __ipc: "cancel" }]);
      expect(port.posted("other")).toStrictEqual([]);
   });
});
