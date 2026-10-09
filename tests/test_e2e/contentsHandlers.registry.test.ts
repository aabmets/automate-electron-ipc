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

// T34: `ipc.<name>.on` / `handle` (and `once` and `handleOnce`) take `{ webContents }`.

import {
   createContents,
   disposeContentsFixture,
   loadMain,
   ok,
} from "@testutils/contents-handlers-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   await disposeContentsFixture();
});

describe("the webContents option of listeners and handlers", () => {
   it("registers on the ipc of the contents, and leaves the global ipcMain alone", async () => {
      const { ipc, globalIpc } = await loadMain();
      const contents = createContents();

      ipc.getUser.handle(async () => "scoped", { webContents: contents });
      ipc.logLine.on(vi.fn(), { webContents: contents });

      expect(contents.ipc.handle).toHaveBeenCalledWith("autoipc:getUser", expect.any(Function));
      expect(contents.ipc.on).toHaveBeenCalledWith("autoipc:logLine", expect.any(Function));
      expect(globalIpc.handle).not.toHaveBeenCalled();
      expect(globalIpc.removeHandler).not.toHaveBeenCalled();
      expect(globalIpc.on).not.toHaveBeenCalled();
   });

   it("registers on the global ipcMain without the option, or with the option left empty", async () => {
      const { ipc, globalIpc } = await loadMain();

      ipc.getUser.handle(async () => "a");
      ipc.logLine.on(vi.fn(), {});
      ipc.logLine.on(vi.fn(), { webContents: undefined });

      expect(globalIpc.handle).toHaveBeenCalledTimes(1);
      expect(globalIpc.on).toHaveBeenCalledTimes(2);
   });

   it("answers an invoke from the handler of the contents, before the global handler", async () => {
      const { ipc, invoke } = await loadMain();
      const first = createContents();
      const second = createContents();
      ipc.getUser.handle(async (_event: unknown, id: number) => `global ${id}`);
      ipc.getUser.handle(async (_event: unknown, id: number) => `first ${id}`, {
         webContents: first,
      });

      expect(await invoke(first, "getUser", 1)).toStrictEqual(ok("first 1"));
      // A page which has no handler of its own is served by the global one.
      expect(await invoke(second, "getUser", 2)).toStrictEqual(ok("global 2"));
   });

   it("lets a handler of the contents serve a channel which has no global handler", async () => {
      const { ipc, invoke } = await loadMain();
      const contents = createContents();
      const other = createContents();
      ipc.getUser.handle(async () => "mine", { webContents: contents });

      expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("mine"));
      await expect(invoke(other, "getUser", 1)).rejects.toThrow("No handler registered");
   });

   it("delivers a send to the listeners of the contents and to the global ones", async () => {
      const { ipc, send } = await loadMain();
      const contents = createContents();
      const other = createContents();
      const scoped = vi.fn();
      const global = vi.fn();
      ipc.logLine.on(scoped, { webContents: contents });
      ipc.logLine.on(global);

      send(contents, "logLine", "from contents");
      send(other, "logLine", "from other");

      expect(scoped).toHaveBeenCalledTimes(1);
      expect(scoped).toHaveBeenCalledWith(
         expect.objectContaining({ sender: contents }),
         "from contents",
      );
      // Electron also hands the message to ipcMain, so a global listener sees both pages.
      expect(global.mock.calls.map(([, text]) => text)).toStrictEqual([
         "from contents",
         "from other",
      ]);
   });

   it("keeps the registries of the global target and of each contents apart", async () => {
      const { ipc, invoke } = await loadMain();
      const first = createContents();
      const second = createContents();
      const disposeGlobal = ipc.getUser.handle(async () => "global");
      const disposeFirst = ipc.getUser.handle(async () => "first", { webContents: first });
      ipc.getUser.handle(async () => "second", { webContents: second });

      disposeFirst();

      // Disposing the handler of one page removes only that one.
      await expect(invoke(first, "getUser", 1)).resolves.toStrictEqual(ok("global"));
      expect(await invoke(second, "getUser", 1)).toStrictEqual(ok("second"));
      disposeGlobal();
      expect(await invoke(second, "getUser", 1)).toStrictEqual(ok("second"));
      await expect(invoke(first, "getUser", 1)).rejects.toThrow("No handler registered");
   });

   describe("handlers", () => {
      it("replaces the handler of the same contents when it is registered again", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         ipc.getUser.handle(async () => "old", { webContents: contents });

         expect(() =>
            ipc.getUser.handle(async () => "new", { webContents: contents }),
         ).not.toThrow();

         expect(contents.ipc.handlers.size).toBe(1);
         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("new"));
      });

      it("makes the disposer of a replaced handler do nothing, so it cannot remove the new one", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         const disposeOld = ipc.getUser.handle(async () => "old", { webContents: contents });
         const disposeNew = ipc.getUser.handle(async () => "new", { webContents: contents });

         disposeOld();
         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("new"));
         disposeNew();
         expect(contents.ipc.handlers.size).toBe(0);
         // Calling a disposer twice is harmless.
         expect(() => disposeNew()).not.toThrow();
         expect(contents.ipc.removeHandler).toHaveBeenCalledTimes(3);
      });

      it("does not let a handler of another page replace or remove the handler of a page", async () => {
         const { ipc, invoke } = await loadMain();
         const first = createContents();
         const second = createContents();
         ipc.getUser.handle(async () => "first", { webContents: first });
         const disposeSecond = ipc.getUser.handle(async () => "second", { webContents: second });

         disposeSecond();

         expect(await invoke(first, "getUser", 1)).toStrictEqual(ok("first"));
      });

      it("handleOnce answers one invoke, then the channel is free", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         ipc.getUser.handleOnce(async () => "once", { webContents: contents });

         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("once"));
         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
         expect(contents.ipc.handlers.size).toBe(0);
      });

      it("handleOnce can be disposed before the invoke", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         const dispose = ipc.getUser.handleOnce(async () => "once", { webContents: contents });

         dispose();

         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
      });
   });

   describe("listeners", () => {
      it("returns a disposer which removes only that listener", async () => {
         const { ipc, send } = await loadMain();
         const contents = createContents();
         const kept = vi.fn();
         const removed = vi.fn();
         ipc.logLine.on(kept, { webContents: contents });
         const dispose = ipc.logLine.on(removed, { webContents: contents });

         send(contents, "logLine", "a");
         dispose();
         send(contents, "logLine", "b");

         expect(removed).toHaveBeenCalledTimes(1);
         expect(kept).toHaveBeenCalledTimes(2);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(1);
      });

      it("once delivers the first message only", async () => {
         const { ipc, send } = await loadMain();
         const contents = createContents();
         const callback = vi.fn();
         ipc.logLine.once(callback, { webContents: contents });

         send(contents, "logLine", "a");
         send(contents, "logLine", "b");

         expect(callback).toHaveBeenCalledTimes(1);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
      });
   });
});
