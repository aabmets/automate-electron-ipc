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
import { afterEach, describe, expect, it, vi } from "vitest";

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

      expect(main).toContain("bindWindowFocused: (browserWindow: BrowserWindow, provider: ");
      expect(main).toContain("provider: () => [focused: boolean] | Promise<[focused: boolean]>");
      expect(main).toContain("provider: () => [title: string, ...tags: string[]] | Promise<");
      expect(main).toContain('browserWindow.on("focus", listener);');
      expect(main).toContain('browserWindow.off("focus", listener);');
      expect(main).toContain('browserWindow.on("page-title-updated", listener);');
      expect(main).not.toContain("bindPlain");
      expect(main).toContain("sendPlain: (browserWindow: BrowserWindow, n: number) =>");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("triggers");
      expect(await project.typecheck()).toBe("");
   });

   describe("generated main process bindings", () => {
      const load = async () => {
         project = await runFixture("triggers");
         return loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() })
            .ipcMain;
      };

      // Regression for B5: every call registered a window listener, and nothing was sent.
      it("sends immediately and registers no listener when the sender is called", async () => {
         const ipcMain = await load();
         const win = createFakeWindow();

         ipcMain.sendWindowFocused(win, true);
         ipcMain.sendWindowFocused(win, false);
         ipcMain.sendWindowFocused(win, true);

         expect(win.webContents.send).toHaveBeenCalledTimes(3);
         expect(win.webContents.send).toHaveBeenNthCalledWith(1, "windowFocused", true);
         expect(win.webContents.send).toHaveBeenNthCalledWith(2, "windowFocused", false);
         expect(win.listenerCount("focus")).toBe(0);
      });

      it("forwards rest arguments with their spread", async () => {
         const ipcMain = await load();
         const win = createFakeWindow();

         ipcMain.sendTitleChanged(win, "title", "a", "b");

         expect(win.webContents.send).toHaveBeenCalledWith("titleChanged", "title", "a", "b");
      });

      it("registers a single listener and evaluates the provider for each event", async () => {
         const ipcMain = await load();
         const win = createFakeWindow();
         let focused = true;
         const provider = vi.fn(() => [focused]);

         ipcMain.bindWindowFocused(win, provider);
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
         const ipcMain = await load();
         const win = createFakeWindow();

         ipcMain.bindTitleChanged(win, async () => ["title", "a", "b"]);
         win.emit("page-title-updated");
         await flush();

         expect(win.webContents.send).toHaveBeenCalledWith("titleChanged", "title", "a", "b");
      });

      it("removes the listener when the disposer is called", async () => {
         const ipcMain = await load();
         const win = createFakeWindow();
         const provider = vi.fn(() => [true]);

         const dispose = ipcMain.bindWindowFocused(win, provider);
         dispose();

         expect(win.listenerCount("focus")).toBe(0);
         win.emit("focus");
         await flush();
         expect(provider).not.toHaveBeenCalled();
         expect(win.webContents.send).not.toHaveBeenCalled();
      });

      it("does not send to a window which was destroyed while the provider ran", async () => {
         const ipcMain = await load();
         const win = createFakeWindow();

         ipcMain.bindWindowFocused(win, () => {
            win.destroyed = true;
            return Promise.resolve([true]);
         });
         win.emit("focus");
         await flush();

         expect(win.webContents.send).not.toHaveBeenCalled();
      });
   });
});

describe("ipcAutomation, async return types", () => {
   // Regression for T56: a user type `PromiseResult` and `PromiseLike<T>` counted as async,
   // so their invoke senders were not typed as promises.
   it("types every invoke sender as a promise of the awaited result", async () => {
      project = await runFixture("async-types");
      const windowTypes = project.generated["window.d.ts"];

      expect(windowTypes).toContain("sendPlain: () => Promise<Awaited<number>>;");
      expect(windowTypes).toContain("sendUserType: () => Promise<Awaited<PromiseResult>>;");
      expect(windowTypes).toContain(
         "sendPromiseLike: () => Promise<Awaited<PromiseLike<string>>>;",
      );
      expect(windowTypes).toContain("sendReal: (id: number) => Promise<string>;");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("async-types");
      expect(await project.typecheck()).toBe("");
   });
});
