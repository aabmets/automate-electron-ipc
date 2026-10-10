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

import { cleanupPortConnect, loadPreload } from "@testutils/e2e/port-connect-utils.js";
import { settle, wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupPortConnect();
});

describe("generated preload script of a port channel", () => {
   it("exposes the six methods and nothing else", async () => {
      const { chat } = await loadPreload();
      expect(Object.keys(chat).sort()).toStrictEqual([
         "on",
         "onClose",
         "onConnection",
         "onOverflow",
         "onReady",
         "send",
      ]);
   });

   // `sendMessage` threw before the port arrived.
   it("queues the sends until the port arrives, and flushes them in order", async () => {
      const { chat, connect } = await loadPreload();

      chat.send("one");
      chat.send("two", 2);
      const { received } = connect();
      chat.send("three");
      await settle();

      expect(received).toStrictEqual([["one"], ["two", 2], ["three"]]);
   });

   it("flushes the queue before it tells the onReady subscribers, so that their sends come last", async () => {
      const { chat, connect } = await loadPreload();
      chat.onReady(() => chat.send("from onReady"));
      chat.send("queued");

      const { received } = connect();
      await settle();

      expect(received).toStrictEqual([["queued"], ["from onReady"]]);
   });

   it("flushes a queue only once", async () => {
      const { chat, connect } = await loadPreload();
      chat.send("once");

      connect();
      const second = connect();
      await settle();

      expect(second.received).toStrictEqual([]);
   });

   it("reports a message which cannot be cloned, and still sends the others", async () => {
      const { chat, connect } = await loadPreload();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      chat.send(() => undefined);
      chat.send("fine");

      const { received } = connect();
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(received).toStrictEqual([["fine"]]);
   });

   it("passes every message to every subscriber, with the arguments spread", async () => {
      const { chat, connect } = await loadPreload();
      const first = vi.fn();
      const second = vi.fn();
      chat.on(first);
      chat.on(second);
      const { peer } = connect();

      peer.postMessage(["hello", 1]);
      await settle();

      expect(first).toHaveBeenCalledExactlyOnceWith("hello", 1);
      expect(second).toHaveBeenCalledExactlyOnceWith("hello", 1);
   });

   it("lets a subscriber leave through its own disposer, even if the callback is the same", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      const disposeFirst = chat.on(callback);
      chat.on(callback);
      const { peer } = connect();

      peer.postMessage(["a"]);
      await settle();
      expect(callback).toHaveBeenCalledTimes(2);

      disposeFirst();
      disposeFirst();
      peer.postMessage(["b"]);
      await settle();
      expect(callback).toHaveBeenCalledTimes(3);
   });

   it("keeps the subscribers of an earlier port for the next one", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      chat.on(callback);

      connect();
      const { peer } = connect();
      peer.postMessage(["later"]);
      await settle();

      expect(callback).toHaveBeenCalledExactlyOnceWith("later");
   });

   it("lets one failing subscriber not keep the others from the message", async () => {
      const { chat, connect } = await loadPreload();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const after = vi.fn();
      chat.on(() => {
         throw new Error("boom");
      });
      chat.on(after);
      const { peer } = connect();

      peer.postMessage(["x"]);
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledWith("x");
   });

   it("ignores a message which is not an array of arguments", async () => {
      const { chat, connect } = await loadPreload();
      const callback = vi.fn();
      chat.on(callback);
      const { peer } = connect();

      peer.postMessage("not an array");
      await settle();

      expect(callback).not.toHaveBeenCalled();
   });

   it("ignores a message to the channel which carries no port", async () => {
      const { chat, listener } = await loadPreload();
      const onReady = vi.fn();
      chat.onReady(onReady);

      listener(wire("chat"))({ ports: [] }, "1:a");

      expect(onReady).not.toHaveBeenCalled();
   });
});
