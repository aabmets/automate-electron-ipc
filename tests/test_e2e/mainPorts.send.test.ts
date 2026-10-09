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

import {
   channelsMade,
   cleanupMainPorts,
   createContents,
   FakeChannelMain,
   fromPage,
   lastPort,
   loadMain,
   loadMainWithElectron,
} from "@testutils/main-port-utils.js";
import { finishLoading } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupMainPorts();
});

describe("ipc.<name>.connect of a mainPort channel", () => {
   describe("send", () => {
      it("queues the messages until the page has loaded, then flushes them in order", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);

         connection.send("one");
         connection.send("two", 2);
         finishLoading(contents);
         connection.send("three");

         expect(lastPort().postMessage.mock.calls).toStrictEqual([
            [["one"]],
            [["two", 2]],
            [["three"]],
         ]);
      });

      it("flushes the queue before it runs the onReady subscribers, so that their sends come last", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         connection.onReady(() => connection.send("from onReady"));
         connection.send("queued");

         finishLoading(contents);

         expect(lastPort().postMessage.mock.calls).toStrictEqual([
            [["queued"]],
            [["from onReady"]],
         ]);
      });

      it("flushes a queue only once", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         connection.send("once");
         finishLoading(contents);
         contents.emit("did-finish-load");

         expect(channelsMade[0].port1.postMessage).toHaveBeenCalledOnce();
         expect(channelsMade[1].port1.postMessage).not.toHaveBeenCalled();
      });

      it("queues again while the connection has no port, such as after the page went away", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const first = lastPort();
         first.emit("close");

         connection.send("while away");
         expect(first.postMessage).not.toHaveBeenCalled();
         contents.emit("did-finish-load");

         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["while away"]]]);
      });

      it("reports a message which cannot be cloned, and still sends the others", async () => {
         class FailingChannel extends FakeChannelMain {
            constructor() {
               super();
               this.port1.postMessage.mockImplementation(([text]: string[]) => {
                  if (text === "bad") {
                     throw new Error("An object could not be cloned");
                  }
               });
            }
         }
         const { ipc } = await loadMainWithElectron(FailingChannel);
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const onReady = vi.fn();
         connection.onReady(onReady);
         connection.send("bad");
         connection.send("fine");

         finishLoading(contents);

         expect(error).toHaveBeenCalledOnce();
         expect(lastPort().postMessage.mock.calls).toStrictEqual([[["bad"]], [["fine"]]]);
         expect(onReady).toHaveBeenCalledOnce();
      });
   });

   describe("on", () => {
      it("hands the arguments that the page sent to every subscriber, each with its own disposer", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const first = vi.fn();
         const second = vi.fn();
         const stopFirst = connection.on(first);
         connection.on(second);

         fromPage(lastPort(), ["line", 3]);
         stopFirst();
         fromPage(lastPort(), ["next"]);

         expect(first.mock.calls).toStrictEqual([["line", 3]]);
         expect(second.mock.calls).toStrictEqual([["line", 3], ["next"]]);
      });

      it("treats the same callback twice as two subscriptions", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         const stop = connection.on(callback);
         connection.on(callback);

         stop();
         fromPage(lastPort(), ["x"]);

         expect(callback).toHaveBeenCalledOnce();
      });

      it("ignores a message which is not an argument list", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         connection.on(callback);

         fromPage(lastPort(), "text");
         fromPage(lastPort(), { length: 1, 0: "x" });
         fromPage(lastPort(), null);

         expect(callback).not.toHaveBeenCalled();
      });

      it("reports a subscriber which throws, and still tells the others", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const failure = new Error("boom");
         const after = vi.fn();
         connection.on(() => {
            throw failure;
         });
         connection.on(after);

         fromPage(lastPort(), ["x"]);

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(after).toHaveBeenCalledOnce();
      });

      it("lets a subscriber stop itself while the others are told", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const after = vi.fn();
         const stop = connection.on(() => stop());
         connection.on(after);

         fromPage(lastPort(), ["x"]);
         fromPage(lastPort(), ["y"]);

         expect(after).toHaveBeenCalledTimes(2);
      });
   });
});
