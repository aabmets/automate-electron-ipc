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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { createFakeElectron, createFakeWindow, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** Lets the pending promise callbacks of the generated listeners run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("ipcAutomation, triggers", () => {
   it("generates a binder for triggered channels only, and a sender for all", async () => {
      project = await runFixture("triggers");
      const main = project.generated["main.ts"];

      expect(main).toContain("bind: (browserWindow: BrowserWindow, provider: ");
      expect(main).toContain("provider: () => [focused: boolean] | Promise<[focused: boolean]>");
      expect(main).toContain("provider: () => [title: string, ...tags: string[]] | Promise<");
      expect(main).toContain('browserWindow.on("focus", listener);');
      expect(main).toContain('browserWindow.off("focus", listener);');
      expect(main).toContain('browserWindow.on("page-title-updated", listener);');
      expect(main.match(/\bbind:/g)).toHaveLength(2);
      expect(main).toContain("plain: {\n      send: (browserWindow: BrowserWindow, n: number) =>");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("triggers");
      expect(await project.typecheck()).toBe("");
   });

   describe("generated main process bindings", () => {
      const load = async () => {
         project = await runFixture("triggers");
         return loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() }).ipc;
      };

      // Regression for B5: every call registered a window listener, and nothing was sent.
      it("sends immediately and registers no listener when the sender is called", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.windowFocused.send(win, true);
         ipc.windowFocused.send(win, false);
         ipc.windowFocused.send(win, true);

         expect(win.webContents.send).toHaveBeenCalledTimes(3);
         expect(win.webContents.send).toHaveBeenNthCalledWith(1, "windowFocused", true);
         expect(win.webContents.send).toHaveBeenNthCalledWith(2, "windowFocused", false);
         expect(win.listenerCount("focus")).toBe(0);
      });

      it("forwards rest arguments with their spread", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.titleChanged.send(win, "title", "a", "b");

         expect(win.webContents.send).toHaveBeenCalledWith("titleChanged", "title", "a", "b");
      });

      it("registers a single listener and evaluates the provider for each event", async () => {
         const ipc = await load();
         const win = createFakeWindow();
         let focused = true;
         const provider = vi.fn(() => [focused]);

         ipc.windowFocused.bind(win, provider);
         expect(win.listenerCount("focus")).toBe(1);
         expect(provider).not.toHaveBeenCalled();
         expect(win.webContents.send).not.toHaveBeenCalled();

         win.emit("focus");
         await flush();
         focused = false;
         win.emit("focus");
         await flush();

         expect(provider).toHaveBeenCalledTimes(2);
         expect(win.webContents.send).toHaveBeenNthCalledWith(1, "windowFocused", true);
         expect(win.webContents.send).toHaveBeenNthCalledWith(2, "windowFocused", false);
      });

      it("awaits asynchronous providers and spreads rest arguments", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.titleChanged.bind(win, async () => ["title", "a", "b"]);
         win.emit("page-title-updated");
         await flush();

         expect(win.webContents.send).toHaveBeenCalledWith("titleChanged", "title", "a", "b");
      });

      it("removes the listener when the disposer is called", async () => {
         const ipc = await load();
         const win = createFakeWindow();
         const provider = vi.fn(() => [true]);

         const dispose = ipc.windowFocused.bind(win, provider);
         dispose();

         expect(win.listenerCount("focus")).toBe(0);
         win.emit("focus");
         await flush();
         expect(provider).not.toHaveBeenCalled();
         expect(win.webContents.send).not.toHaveBeenCalled();
      });

      it("does not send to a window which was destroyed while the provider ran", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.windowFocused.bind(win, () => {
            win.destroyed = true;
            return Promise.resolve([true]);
         });
         win.emit("focus");
         await flush();

         expect(win.webContents.send).not.toHaveBeenCalled();
      });

      describe("errors of the provider", () => {
         const unhandled = vi.fn();
         const failures: [string, () => unknown][] = [
            [
               "throws",
               () => {
                  throw new Error("boom");
               },
            ],
            ["rejects", () => Promise.reject(new Error("boom"))],
         ];

         beforeEach(() => {
            unhandled.mockClear();
            process.on("unhandledRejection", unhandled);
         });
         afterEach(() => {
            process.off("unhandledRejection", unhandled);
            vi.restoreAllMocks();
         });

         it.each(failures)(
            "reports a provider which %s to onError and skips the send",
            async (_, fail) => {
               const ipc = await load();
               const win = createFakeWindow();
               const onError = vi.fn();
               let failing = true;

               ipc.windowFocused.bind(win, () => (failing ? fail() : [true]), onError);
               win.emit("focus");
               await flush();

               expect(onError).toHaveBeenCalledTimes(1);
               expect(onError.mock.calls[0][0]).toMatchObject({ message: "boom" });
               expect(win.webContents.send).not.toHaveBeenCalled();

               // Regression for T63: later events must still send.
               failing = false;
               win.emit("focus");
               await flush();

               expect(onError).toHaveBeenCalledTimes(1);
               expect(win.webContents.send).toHaveBeenCalledTimes(1);
               expect(win.webContents.send).toHaveBeenCalledWith("windowFocused", true);
               expect(unhandled).not.toHaveBeenCalled();
            },
         );

         it.each(failures)(
            "falls back to console.error for a provider which %s",
            async (_, fail) => {
               const ipc = await load();
               const win = createFakeWindow();
               const consoleError = vi.spyOn(console, "error").mockReturnValue(undefined);

               ipc.windowFocused.bind(win, fail);
               win.emit("focus");
               await flush();

               expect(consoleError).toHaveBeenCalledTimes(1);
               expect(consoleError.mock.calls[0][0]).toMatchObject({ message: "boom" });
               expect(win.webContents.send).not.toHaveBeenCalled();
               expect(unhandled).not.toHaveBeenCalled();
            },
         );

         it("reports an error of the send itself to onError", async () => {
            const ipc = await load();
            const win = createFakeWindow();
            const onError = vi.fn();
            win.webContents.send.mockImplementationOnce(() => {
               throw new Error("An object could not be cloned.");
            });

            ipc.windowFocused.bind(win, () => [true], onError);
            win.emit("focus");
            await flush();
            win.emit("focus");
            await flush();

            expect(onError).toHaveBeenCalledTimes(1);
            expect(win.webContents.send).toHaveBeenCalledTimes(2);
            expect(unhandled).not.toHaveBeenCalled();
         });
      });
   });
});

describe("ipcAutomation, parameter names and generic signatures", () => {
   // Regression for T57: `(browserWindow: number)` produced a duplicate parameter (TS2300),
   // and `event` and `callback` could shadow the names that the wrappers use.
   it("renames generated parameters that clash with the ones of the signature", async () => {
      project = await runFixture("param-clashes");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "send: (_browserWindow: BrowserWindow, browserWindow: number, event: string, callback: boolean) =>",
      );
      expect(main).toContain(
         "_browserWindow.webContents.send('windowClash', browserWindow, event, callback)",
      );
      expect(main).toContain(
         "(_event: IpcMainEvent, event: string, callback: number, args: boolean) => {",
      );
      expect(main).toContain("return _callback(_event, event, callback, args);");
      expect(main).toContain("on: (callback: (event: IpcMainEvent) => void)");
   });

   it("inserts the event parameter after the type parameters of generic signatures", async () => {
      project = await runFixture("param-clashes");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "(callback: <T extends (x: number) => void>(event: IpcMainEvent, cb: T) => void)",
      );
      expect(main).toContain("<T extends (x: number) => void>(event: IpcMainEvent, cb: T) => {");
      expect(main).toContain("return callback(event, cb);");
      expect(main).toContain(
         "send: <T extends (x: number) => void>(browserWindow: BrowserWindow, cb: T) =>",
      );
      expect(project.generated["window.d.ts"]).toContain(
         "invoke: <T>(value: T) => Promise<Awaited<T>>;",
      );
   });

   it("generates files that type-check", async () => {
      project = await runFixture("param-clashes");
      expect(await project.typecheck()).toBe("");
   });

   it("forwards the arguments to the right parameters at runtime", async () => {
      project = await runFixture("param-clashes");
      const electron = createFakeElectron();
      const { ipc } = loadGenerated(project.generated["main.ts"], { electron });
      const win = createFakeWindow();

      ipc.windowClash.send(win, 1, "two", true);
      expect(win.webContents.send).toHaveBeenCalledWith("windowClash", 1, "two", true);

      const callback = vi.fn();
      ipc.handlerClash.on(callback);
      const [channel, listener] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe("handlerClash");
      listener("the-event", "a", 2, false);
      expect(callback).toHaveBeenCalledWith("the-event", "a", 2, false);
   });
});

describe("ipcAutomation, async return types", () => {
   // Regression for T56: a user type `PromiseResult` and `PromiseLike<T>` counted as async,
   // so their invoke senders were not typed as promises.
   it("types every invoke sender as a promise of the awaited result", async () => {
      project = await runFixture("async-types");
      const windowTypes = project.generated["window.d.ts"];

      const invokeOf = (channel: string) => {
         const lines = windowTypes.split("\n");
         return lines[lines.indexOf(`   ${channel}: {`) + 2].trim();
      };
      expect(invokeOf("plain")).toBe("invoke: () => Promise<Awaited<number>>;");
      expect(invokeOf("userType")).toBe("invoke: () => Promise<Awaited<PromiseResult>>;");
      expect(invokeOf("promiseLike")).toBe("invoke: () => Promise<Awaited<PromiseLike<string>>>;");
      expect(invokeOf("real")).toBe("invoke: (id: number) => Promise<string>;");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("async-types");
      expect(await project.typecheck()).toBe("");
   });
});
