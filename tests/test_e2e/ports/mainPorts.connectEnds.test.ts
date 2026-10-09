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

import { createContents, FakeContents } from "@testutils/e2e/fake-contents.js";
import {
   cleanupMainPorts,
   disconnectListener,
   loadMain,
   loadMainWithElectron,
} from "@testutils/e2e/main-port-utils.js";
import { closeWire, disconnectWire, wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupMainPorts();
});

describe("ipc.<name>.connect of a mainPort channel", () => {
   // Regression for T78, which found that `connect` of a `port` channel leaves entries behind when
   // its second window is destroyed. A `mainPort` channel takes one target, and resolves it first.
   describe("a target that was destroyed before connect", () => {
      const eventsOf = ["did-navigate", "did-fail-load", "did-finish-load", "did-stop-loading"];

      /** A window like the one of Electron: once it is destroyed, its `webContents` getter throws. */
      const destroyedWindow = () => ({
         get webContents(): never {
            throw new TypeError("Object has been destroyed");
         },
      });

      const leftOn = (contents: FakeContents) =>
         Object.fromEntries(eventsOf.map((event) => [event, contents.listenerCount(event)]));
      const noListeners = leftOn(createContents());

      it("throws Electron's own error for a destroyed window, and registers nothing", async () => {
         const ipc = await loadMain();
         ipc.logTail.connect(createContents());

         expect(() => ipc.logTail.connect(destroyedWindow())).toThrow(
            new TypeError("Object has been destroyed"),
         );

         // The window failed before it was given a key, so the next connection gets the next key.
         const live = createContents();
         ipc.logTail.connect(live);
         expect(live.postMessage.mock.calls[0].slice(0, 2)).toStrictEqual([
            wire("logTail"),
            "2:main",
         ]);
      });

      it("throws for contents that are destroyed, and registers nothing", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         ipc.logTail.connect(createContents());
         const contents = createContents();
         contents.destroyed = true;

         expect(() => ipc.logTail.connect(contents)).toThrow(
            new TypeError("Object has been destroyed"),
         );
         expect(leftOn(contents)).toStrictEqual(noListeners);

         // The key that it would have had does nothing, and the live connection is untouched.
         disconnectListener(electron)({ sender: contents }, "2:main");
         expect(contents.send).not.toHaveBeenCalled();
         const live = createContents();
         ipc.logTail.connect(live);
         expect(live.postMessage.mock.calls[0].slice(0, 2)).toStrictEqual([
            wire("logTail"),
            "2:main",
         ]);
      });

      it("removes what it registered when the setup fails", async () => {
         class FailingChannel {
            constructor() {
               throw new Error("no more ports");
            }
         }
         const { ipc } = await loadMainWithElectron(FailingChannel);
         const contents = createContents();

         expect(() => ipc.logTail.connect(contents)).toThrow("no more ports");

         expect(leftOn(contents)).toStrictEqual(noListeners);
         expect(contents.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         contents.emit("did-finish-load");
         expect(contents.postMessage).not.toHaveBeenCalled();
      });
   });

   describe("a page which ends its connection", () => {
      it("listens for it once for the channel, however many connections there are", async () => {
         const { ipc, electron } = await loadMainWithElectron();

         ipc.logTail.connect(createContents());
         ipc.logTail.connect(createContents());

         const calls = electron.ipcMain.on.mock.calls.filter(
            ([channel]: [string]) => channel === disconnectWire("logTail"),
         );
         expect(calls).toHaveLength(1);
      });

      it("ends the connection when the contents which hold the end ask", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const [one, two] = [createContents(), createContents()];
         const connection = ipc.logTail.connect(one);
         ipc.logTail.connect(two);
         const onClose = vi.fn();
         connection.onClose(onClose);

         disconnectListener(electron)({ sender: one }, "1:main");

         expect(onClose).toHaveBeenCalledOnce();
         expect(one.send).toHaveBeenCalledExactlyOnceWith(closeWire("logTail"), "1:main");
         expect(two.send).not.toHaveBeenCalled();
         one.emit("did-finish-load");
         expect(one.postMessage).toHaveBeenCalledOnce();
      });

      it("ignores other contents, an unknown key and a key which is no text", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const contents = createContents();
         const stranger = createContents();
         ipc.logTail.connect(contents);
         const disconnect = disconnectListener(electron);

         disconnect({ sender: stranger }, "1:main");
         disconnect({ sender: contents }, "9:main");
         disconnect({ sender: contents }, 1);
         disconnect({ sender: contents }, undefined);
         disconnect({ sender: contents }, "__proto__");

         expect(contents.send).not.toHaveBeenCalled();
      });

      it("forgets the end of a connection once it is closed", async () => {
         const { ipc, electron } = await loadMainWithElectron();
         const contents = createContents();
         ipc.logTail.connect(contents).close();

         disconnectListener(electron)({ sender: contents }, "1:main");

         expect(contents.send).toHaveBeenCalledOnce();
      });
   });
});
