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
   cleanupRuntime,
   generateFixture,
   loadMainWithEmitter,
} from "@testutils/e2e/runtime-main-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakeWindow,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupRuntime);

describe("generated main process bindings", () => {
   it("exports one object per channel, with only the methods of its verb", async () => {
      const project = await generateFixture("all-kinds");
      const { ipc } = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
      });

      expect(callablePaths(ipc)).toStrictEqual([
         "chat.connect",
         "getTime.handle",
         "getTime.handleOnce",
         "getUser.handle",
         "getUser.handleOnce",
         "logLine.on",
         "logLine.once",
         "progress.broadcast",
         "progress.broadcastTo",
         "progress.send",
         "progress.sendToSender",
         "titleChanged.bind",
         "titleChanged.broadcast",
         "titleChanged.broadcastTo",
         "titleChanged.send",
         "titleChanged.sendToSender",
      ]);
   });

   async function loadMain() {
      const project = await generateFixture("all-kinds");
      class FakeChannel {
         port1 = { name: "port1" };
         port2 = { name: "port2" };
      }
      const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannel };
      return {
         electron,
         ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc,
      };
   }

   it("registers a handle wrapper which passes the event and arguments to the callback", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn(async (_event: unknown, id: number) => `user ${id}`);

      ipc.getUser.handle(callback);

      expect(electron.ipcMain.handle).toHaveBeenCalledOnce();
      const [channel, wrapper] = electron.ipcMain.handle.mock.calls[0];
      expect(channel).toBe(wire("getUser"));
      const event = { sender: "renderer" };
      await expect(wrapper(event, 3)).resolves.toStrictEqual({ ok: true, value: "user 3" });
      expect(callback).toHaveBeenCalledWith(event, 3);
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("returns the rejection of the callback to the renderer through handle", async () => {
      const { electron, ipc } = await loadMain();
      ipc.getTime.handle(() => Promise.reject(new Error("no clock")));

      const [, wrapper] = electron.ipcMain.handle.mock.calls[0];
      await expect(wrapper({})).resolves.toStrictEqual({
         ok: false,
         error: { name: "Error", message: "no clock" },
      });
   });

   it("registers an on wrapper which spreads rest arguments", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn();

      ipc.logLine.on(callback);

      const [channel, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe(wire("logLine"));
      wrapper("event", "line", 1, 2);
      expect(callback).toHaveBeenCalledWith("event", "line", 1, 2);
   });

   it("returns a function from on which removes only that listener with ipcMain.off", async () => {
      const { electron, ipc } = await loadMain();
      ipc.logLine.on(vi.fn());
      const dispose = ipc.logLine.on(vi.fn());
      const [[, first], [, second]] = electron.ipcMain.on.mock.calls;

      expect(typeof dispose).toBe("function");
      expect(dispose()).toBeUndefined();

      expect(electron.ipcMain.off).toHaveBeenCalledOnce();
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), second);
      expect(second).not.toBe(first);
   });

   it("stops delivering to a disposed on listener, and to nobody else", async () => {
      const { emitter, ipc } = await loadMainWithEmitter();
      const kept = vi.fn();
      const removed = vi.fn();
      ipc.logLine.on(kept);
      const dispose = ipc.logLine.on(removed);

      emitter.emit("logLine", {}, "a");
      dispose();
      emitter.emit("logLine", {}, "b");

      expect(removed).toHaveBeenCalledTimes(1);
      expect(kept).toHaveBeenCalledTimes(2);
      expect(emitter.listenerCount("logLine")).toBe(1);
   });

   it("once delivers a single message with the event, and can be disposed before it", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn();

      const dispose = ipc.logLine.once(callback);

      // A normal listener, which removes itself, so that a rejected sender cannot use it up.
      const [channel, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe(wire("logLine"));
      expect(electron.ipcMain.once).not.toHaveBeenCalled();
      wrapper("event", "line", 1, 2);
      expect(callback).toHaveBeenCalledWith("event", "line", 1, 2);
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), wrapper);

      electron.ipcMain.off.mockClear();
      dispose();
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), wrapper);
   });

   it("once delivers to the first message only, with a real emitter", async () => {
      const { emitter, ipc } = await loadMainWithEmitter();
      const callback = vi.fn();
      ipc.logLine.once(callback);

      emitter.emit("logLine", {}, "a");
      emitter.emit("logLine", {}, "b");

      expect(callback).toHaveBeenCalledOnce();
      expect(emitter.listenerCount("logLine")).toBe(0);
   });

   it("replaces the handler of a channel when it is registered again", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      ipc.getUser.handle(async () => "old");
      expect(() => ipc.getUser.handle(async () => "new")).not.toThrow();

      expect(handlers.size).toBe(1);
      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("new");
   });

   it("calls removeHandler before it registers a handler", async () => {
      const { electron, ipc } = await loadMain();
      const order: string[] = [];
      electron.ipcMain.removeHandler.mockImplementation(() => order.push("remove"));
      electron.ipcMain.handle.mockImplementation(() => order.push("handle"));

      ipc.getUser.handle(async () => "a");
      ipc.getUser.handleOnce(async () => "b");

      expect(order).toStrictEqual(["remove", "handle", "remove", "handle"]);
      expect(electron.ipcMain.handleOnce).not.toHaveBeenCalled();
      expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(wire("getUser"));
   });

   it("removes the handler through the disposer of handle", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      const dispose = ipc.getUser.handle(async () => "user");
      expect(handlers.has("getUser")).toBe(true);

      expect(dispose()).toBeUndefined();
      expect(handlers.has("getUser")).toBe(false);
      // The channel is free again.
      expect(() => ipc.getUser.handle(async () => "again")).not.toThrow();
   });

   it("leaves the replacement alone when the disposer of a replaced handler is called", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      const disposeOld = ipc.getUser.handle(async () => "old");
      const disposeNew = ipc.getUser.handle(async () => "new");
      disposeOld();

      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("new");
      disposeNew();
      expect(handlers.has("getUser")).toBe(false);
      // A disposer which is called twice does not remove a later handler either.
      ipc.getUser.handle(async () => "later");
      disposeNew();
      expect(handlers.has("getUser")).toBe(true);
   });

   it("handleOnce answers one invoke with the event and arguments, then the channel is free", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();
      const callback = vi.fn(async (_event: unknown, id: number) => `user ${id}`);

      ipc.getUser.handleOnce(callback);
      const event = { sender: "renderer" };

      await expect(handlers.get("getUser")?.(event, 7)).resolves.toBe("user 7");
      expect(callback).toHaveBeenCalledWith(event, 7);
      expect(handlers.has("getUser")).toBe(false);
   });

   it("handleOnce replaces an earlier handler, and its disposer works before the invoke", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();
      ipc.getUser.handle(async () => "old");

      const dispose = ipc.getUser.handleOnce(async () => "once");
      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("once");

      const disposeAgain = ipc.getUser.handleOnce(async () => "again");
      expect(handlers.has("getUser")).toBe(true);
      disposeAgain();
      expect(handlers.has("getUser")).toBe(false);
      dispose();
      expect(handlers.has("getUser")).toBe(false);
   });

   it("posts the two ends of a port channel to the two windows once they have loaded", async () => {
      const { ipc } = await loadMain();
      const loaded = () =>
         Object.assign(createFakeWindow(), {
            webContents: {
               postMessage: vi.fn(),
               send: vi.fn(),
               on: vi.fn(),
               off: vi.fn(),
               isLoading: () => false,
               isDestroyed: () => false,
               getURL: () => "app://.",
            },
         });
      const one = loaded();
      const two = loaded();

      ipc.chat.connect(one, two);

      expect(one.webContents.postMessage).toHaveBeenCalledWith(wire("chat"), "1:a", [
         { name: "port1" },
      ]);
      expect(two.webContents.postMessage).toHaveBeenCalledWith(wire("chat"), "1:b", [
         { name: "port2" },
      ]);
   });
});
