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
      expect(main).toContain(
         "plain: {\n      send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, n: number) =>",
      );
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
         expect(win.webContents.send).toHaveBeenNthCalledWith(1, "autoipc:windowFocused", true);
         expect(win.webContents.send).toHaveBeenNthCalledWith(2, "autoipc:windowFocused", false);
         expect(win.listenerCount("focus")).toBe(0);
      });

      it("forwards rest arguments with their spread", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.titleChanged.send(win, "title", "a", "b");

         expect(win.webContents.send).toHaveBeenCalledWith(
            "autoipc:titleChanged",
            "title",
            "a",
            "b",
         );
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
         expect(win.webContents.send).toHaveBeenNthCalledWith(1, "autoipc:windowFocused", true);
         expect(win.webContents.send).toHaveBeenNthCalledWith(2, "autoipc:windowFocused", false);
      });

      it("awaits asynchronous providers and spreads rest arguments", async () => {
         const ipc = await load();
         const win = createFakeWindow();

         ipc.titleChanged.bind(win, async () => ["title", "a", "b"]);
         win.emit("page-title-updated");
         await flush();

         expect(win.webContents.send).toHaveBeenCalledWith(
            "autoipc:titleChanged",
            "title",
            "a",
            "b",
         );
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
               expect(win.webContents.send).toHaveBeenCalledWith("autoipc:windowFocused", true);
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
