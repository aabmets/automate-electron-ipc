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
   closeWire,
   createContents,
   destroy,
   lastPort,
   loadMain,
} from "@testutils/main-port-utils.js";
import { finishLoading } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupMainPorts();
});

describe("ipc.<name>.connect of a mainPort channel", () => {
   describe("onReady and onClose", () => {
      it("runs onReady at once when a port is there, and not when there is none", async () => {
         const ipc = await loadMain();
         const paired = ipc.logTail.connect(createContents());
         const waiting = ipc.logTail.connect(createContents({ loading: true }));
         const early = vi.fn();
         const late = vi.fn();

         paired.onReady(early);
         waiting.onReady(late);

         expect(early).toHaveBeenCalledOnce();
         expect(late).not.toHaveBeenCalled();
      });

      it("stops an onReady subscriber with its disposer", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const callback = vi.fn();
         const stop = connection.onReady(callback);

         stop();
         contents.emit("did-finish-load");

         expect(callback).toHaveBeenCalledOnce();
      });

      it("runs onClose when the port closes, such as when the page goes away", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const callback = vi.fn();
         const stop = connection.onClose(callback);
         const other = vi.fn();
         connection.onClose(other);

         lastPort().emit("close");
         stop();
         lastPort().emit("close");

         expect(callback).toHaveBeenCalledOnce();
         expect(other).toHaveBeenCalledOnce();
      });

      it("reports an onClose subscriber which throws, and still tells the others", async () => {
         const ipc = await loadMain();
         const connection = ipc.logTail.connect(createContents());
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const after = vi.fn();
         connection.onClose(() => {
            throw new Error("boom");
         });
         connection.onClose(after);

         lastPort().emit("close");

         expect(error).toHaveBeenCalledOnce();
         expect(after).toHaveBeenCalledOnce();
      });
   });

   describe("close", () => {
      it("tells the page, closes the port, runs onClose and pairs no more", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         const port = lastPort();

         connection.close();

         expect(contents.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         expect(port.close).toHaveBeenCalledOnce();
         expect(onClose).toHaveBeenCalledOnce();
         expect(contents.listenerCount("did-finish-load")).toBe(0);
         expect(contents.listenerCount("destroyed")).toBe(0);
         // A reload does not bring the connection back.
         contents.emit("did-finish-load");
         expect(contents.postMessage).toHaveBeenCalledOnce();
      });

      it("ends for good once, and drops the sends that come after it", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         const port = lastPort();

         connection.close();
         connection.close();
         connection.send("late");

         expect(contents.send).toHaveBeenCalledOnce();
         expect(onClose).toHaveBeenCalledOnce();
         expect(port.postMessage).not.toHaveBeenCalled();
      });

      it("does not run onClose when no port was there, but still ends the connection", async () => {
         const ipc = await loadMain();
         const contents = createContents({ loading: true });
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);
         connection.send("never sent");

         connection.close();
         finishLoading(contents);

         expect(onClose).not.toHaveBeenCalled();
         expect(channelsMade).toHaveLength(0);
         expect(contents.postMessage).not.toHaveBeenCalled();
      });

      it("ends the connection when the contents are destroyed, without sending to them", async () => {
         const ipc = await loadMain();
         const contents = createContents();
         const connection = ipc.logTail.connect(contents);
         const onClose = vi.fn();
         connection.onClose(onClose);

         destroy(contents);
         connection.close();

         expect(onClose).toHaveBeenCalledOnce();
         expect(lastPort().close).toHaveBeenCalledOnce();
         expect(contents.send).not.toHaveBeenCalled();
      });

      it("keeps the other connections of the same channel", async () => {
         const ipc = await loadMain();
         const [one, two] = [createContents(), createContents()];
         const first = ipc.logTail.connect(one);
         ipc.logTail.connect(two);

         first.close();
         one.emit("did-finish-load");
         two.emit("did-finish-load");

         expect(one.postMessage).toHaveBeenCalledOnce();
         expect(two.postMessage).toHaveBeenCalledTimes(2);
         expect(two.send).not.toHaveBeenCalled();
      });
   });
});
