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

// T46: the channels of the generated `mock.ts` that the main process talks to, and its installation.

import { type LoadedMock, loadMock } from "@testutils/e2e/mock-utils.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("the generated mock of the API", () => {
   let loaded: LoadedMock;
   beforeAll(async () => {
      loaded = await loadMock();
   });

   describe("emit channels", () => {
      it("calls the listeners in the order of subscription", () => {
         const mock = loaded.createIpcMock();
         const order: string[] = [];
         mock.titleChanged.on((title: string) => order.push(`first ${title}`));
         mock.titleChanged.on((title: string) => order.push(`second ${title}`));

         mock.emit.titleChanged("Home");

         expect(order).toStrictEqual(["first Home", "second Home"]);
      });

      it("passes all the arguments, and keeps the channels apart", () => {
         const mock = loaded.createIpcMock();
         const progress = vi.fn();
         const title = vi.fn();
         mock.progress.on(progress);
         mock.titleChanged.on(title);

         mock.emit.progress(50, "half");

         expect(progress).toHaveBeenCalledWith(50, "half");
         expect(title).not.toHaveBeenCalled();
      });

      it("stops calling a listener after its disposer, and the disposer is idempotent", () => {
         const mock = loaded.createIpcMock();
         const kept = vi.fn();
         const removed = vi.fn();
         mock.titleChanged.on(kept);
         const dispose = mock.titleChanged.on(removed);

         dispose();
         dispose();
         mock.emit.titleChanged("a");

         expect(removed).not.toHaveBeenCalled();
         expect(kept).toHaveBeenCalledTimes(1);
      });

      it("removes a once listener before it runs, so it is called one time", () => {
         const mock = loaded.createIpcMock();
         const seen: string[] = [];
         mock.titleChanged.once((title: string) => {
            seen.push(title);
            // A message that the listener causes does not reach it again.
            if (seen.length < 5) {
               mock.emit.titleChanged("again");
            }
         });

         mock.emit.titleChanged("first");
         mock.emit.titleChanged("second");

         expect(seen).toStrictEqual(["first"]);
      });

      it("does not call a listener that an earlier listener removed during the dispatch", () => {
         const mock = loaded.createIpcMock();
         const later = vi.fn();
         let dispose = () => undefined;
         mock.titleChanged.on(() => dispose());
         dispose = mock.titleChanged.on(later);

         mock.emit.titleChanged("x");

         expect(later).not.toHaveBeenCalled();
      });

      it("logs a listener that throws, and still calls the others", () => {
         const mock = loaded.createIpcMock();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const failure = new Error("listener");
         const after = vi.fn();
         mock.titleChanged.on(() => {
            throw failure;
         });
         mock.titleChanged.on(after);

         try {
            mock.emit.titleChanged("x");

            expect(error).toHaveBeenCalledWith(failure);
            expect(after).toHaveBeenCalledWith("x");
         } finally {
            error.mockRestore();
         }
      });
   });

   describe("ask channels", () => {
      it("calls the responder of the page and resolves its result", async () => {
         const mock = loaded.createIpcMock();
         mock.hasUnsaved.handle((id: number) => id === 1);
         mock.askName.handle(async () => "Ann");

         await expect(mock.ask.hasUnsaved(1)).resolves.toBe(true);
         await expect(mock.ask.hasUnsaved(2)).resolves.toBe(false);
         await expect(mock.ask.askName()).resolves.toBe("Ann");
      });

      it("rejects when the page registered no responder", async () => {
         const mock = loaded.createIpcMock();

         await expect(mock.ask.hasUnsaved(1)).rejects.toMatchObject({
            name: "IpcAskError",
            code: "IPC_ASK_NO_HANDLER",
            message: "No handler is registered for the channel 'hasUnsaved'",
         });
      });

      it("rejects with the error of a responder that throws", async () => {
         const mock = loaded.createIpcMock();
         mock.hasUnsaved.handle(() => {
            throw new Error("broken");
         });

         await expect(mock.ask.hasUnsaved(1)).rejects.toThrow("broken");
      });

      it("keeps one responder: a new one replaces it, and a disposer removes only its own", async () => {
         const mock = loaded.createIpcMock();
         const disposeFirst = mock.hasUnsaved.handle(() => "first");
         mock.hasUnsaved.handle(() => "second");

         disposeFirst();

         await expect(mock.ask.hasUnsaved(1)).resolves.toBe("second");
      });

      it("rejects again after the disposer of the responder", async () => {
         const mock = loaded.createIpcMock();
         const dispose = mock.hasUnsaved.handle(() => true);

         dispose();

         await expect(mock.ask.hasUnsaved(1)).rejects.toMatchObject({ code: "IPC_ASK_NO_HANDLER" });
      });
   });

   describe("port channels", () => {
      it.each(["send", "on", "onReady", "onClose", "onOverflow", "onConnection"])(
         "throws from %s",
         (method) => {
            const mock = loaded.createIpcMock();

            expect(() => mock.chat[method](() => undefined)).toThrow("ports are not mocked");
         },
      );
   });

   describe("installIpcMock", () => {
      it("sets the mock as ipc of the target, and removes it again", () => {
         const target: Record<string, unknown> = {};
         const mock = loaded.createIpcMock();

         const uninstall = loaded.installIpcMock(mock, target);

         expect(target.ipc).toBe(mock);
         uninstall();
         expect("ipc" in target).toBe(false);
      });

      it("restores the value that the target had", () => {
         const before = { previous: true };
         const target: Record<string, unknown> = { ipc: before };

         const uninstall = loaded.installIpcMock(loaded.createIpcMock(), target);
         uninstall();

         expect(target.ipc).toBe(before);
      });

      it("uninstalls one time only", () => {
         const target: Record<string, unknown> = {};
         const uninstall = loaded.installIpcMock(loaded.createIpcMock(), target);
         uninstall();
         target.ipc = "set later";

         uninstall();

         expect(target.ipc).toBe("set later");
      });

      it("makes a mock of its own, and installs it on globalThis, by default", () => {
         const uninstall = loaded.installIpcMock();
         try {
            expect((globalThis as any).ipc.getUser.invoke).toBeTypeOf("function");
         } finally {
            uninstall();
         }

         expect("ipc" in globalThis).toBe(false);
      });
   });
});

describe("the generated mock with other config", () => {
   it("installs under the name of exposeAs", async () => {
      const { createIpcMock, installIpcMock } = await loadMock("mock", { exposeAs: "bridge" });
      const target: Record<string, unknown> = {};

      installIpcMock(createIpcMock(), target);

      expect(Object.keys(target)).toStrictEqual(["bridge"]);
   });

   it("has no getPathForFile unless the config asks for it", async () => {
      const { createIpcMock } = await loadMock("mock", { getPathForFile: false });

      expect("getPathForFile" in createIpcMock()).toBe(false);
   });
});
