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

// T34: the registrations on `webContents.ipc` are removed when the contents are destroyed.

import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import {
   type Contents,
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
   describe("when the contents are destroyed", () => {
      it("removes the handlers and the listeners from the ipc of the contents", async () => {
         const { ipc, send, invoke } = await loadMain();
         const contents = createContents();
         const listener = vi.fn();
         ipc.getUser.handle(async () => "mine", { webContents: contents });
         ipc.logLine.on(listener, { webContents: contents });

         contents.destroy();

         expect(contents.ipc.removeHandler).toHaveBeenCalledWith("autoipc:getUser");
         expect(contents.ipc.off).toHaveBeenCalledWith("autoipc:logLine", expect.any(Function));
         expect(contents.ipc.handlers.size).toBe(0);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
         send(contents, "logLine", "late");
         expect(listener).not.toHaveBeenCalled();
         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
      });

      it("leaves the registrations of other contents and the global ones alone", async () => {
         const { ipc, send, invoke } = await loadMain();
         const gone = createContents();
         const staying = createContents();
         const globalListener = vi.fn();
         ipc.getUser.handle(async () => "gone", { webContents: gone });
         ipc.getUser.handle(async () => "staying", { webContents: staying });
         ipc.logLine.on(globalListener);

         gone.destroy();

         expect(await invoke(staying, "getUser", 1)).toStrictEqual(ok("staying"));
         send(staying, "logLine", "still there");
         expect(globalListener).toHaveBeenCalledTimes(1);
      });

      it("makes the disposers harmless afterwards", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();
         const disposeHandler = ipc.getUser.handle(async () => "mine", { webContents: contents });
         const disposeListener = ipc.logLine.on(vi.fn(), { webContents: contents });

         contents.destroy();

         expect(() => disposeHandler()).not.toThrow();
         expect(() => disposeListener()).not.toThrow();
      });

      it("does not touch the destroyed event for a registration which was disposed", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();
         const dispose = ipc.logLine.on(vi.fn(), { webContents: contents });
         dispose();
         contents.ipc.off.mockClear();

         contents.destroy();

         expect(contents.ipc.off).not.toHaveBeenCalled();
      });

      it("uses one destroyed listener for all registrations of the contents", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();

         for (let i = 0; i < 25; i++) {
            ipc.logLine.on(vi.fn(), { webContents: contents });
            ipc.logLine.once(vi.fn(), { webContents: contents });
         }
         ipc.getUser.handle(async () => "a", { webContents: contents });
         ipc.getTime.handleOnce(async () => 1, { webContents: contents });

         // Node warns when there are more than ten listeners of one event.
         expect(contents.listenerCount("destroyed")).toBe(1);
         contents.destroy();
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
         expect(contents.ipc.handlers.size).toBe(0);
      });

      describe("a handler that another one replaced", () => {
         /** Whether the callback of a handler which `count` newer ones replaced can be collected. */
         async function isReleased(options: (contents: Contents) => object): Promise<boolean> {
            v8.setFlagsFromString("--expose-gc");
            const gc = runInNewContext("gc") as () => void;
            const { ipc, globalIpc } = await loadMain();
            const contents = createContents();
            let first: (() => Promise<string>) | undefined = async () => "first";
            const released = new WeakRef(first);
            ipc.getUser.handle(first, options(contents));
            first = undefined;
            for (let i = 0; i < 5; i++) {
               ipc.getUser.handle(async () => `newer ${i}`, options(contents));
            }
            // The calls that the mocks of the fakes record would keep the callback alive too.
            for (const fake of [globalIpc, contents.ipc]) {
               fake.handle.mockClear();
               fake.removeHandler.mockClear();
            }
            for (let i = 0; i < 10 && released.deref(); i++) {
               // biome-ignore lint/performance/noAwaitInLoops: each collection waits for the last one
               await new Promise((resolve) => setImmediate(resolve));
               gc();
            }
            return released.deref() === undefined;
         }

         // A control, which shows that the check can see a callback being collected.
         it("is released when the handler is global", async () => {
            expect(await isReleased(() => ({}))).toBe(true);
         });

         // The record of the contents used to keep the remover of each replaced registration until
         // the contents were destroyed, and the remover holds the replaced callback (T87).
         it("is released when the handler is registered on the contents", async () => {
            expect(await isReleased((contents) => ({ webContents: contents }))).toBe(true);
         });
      });

      it("throws for contents which are already destroyed, and registers nothing", async () => {
         const { ipc, globalIpc } = await loadMain();
         const contents = createContents();
         contents.destroy();

         expect(() => ipc.getUser.handle(async () => "x", { webContents: contents })).toThrow(
            new TypeError("Object has been destroyed"),
         );
         expect(() => ipc.logLine.on(vi.fn(), { webContents: contents })).toThrow(TypeError);
         expect(contents.ipc.handle).not.toHaveBeenCalled();
         expect(contents.ipc.on).not.toHaveBeenCalled();
         expect(globalIpc.handle).not.toHaveBeenCalled();
      });
   });
});
