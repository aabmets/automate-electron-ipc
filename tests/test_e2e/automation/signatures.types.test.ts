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
   createFakeElectron,
   createFakeWindow,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

describe("ipcAutomation, parameter names and generic signatures", () => {
   // Regression for T57: `(browserWindow: number)` produced a duplicate parameter (TS2300),
   // and `event` and `callback` could shadow the names that the wrappers use.
   it("renames generated parameters that clash with the ones of the signature", async () => {
      project = await runFixture("param-clashes");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, browserWindow: number, event: string, callback: boolean) =>",
      );
      expect(main).toContain(
         "resolveSendTarget(target).send('autoipc:windowClash', browserWindow, event, callback)",
      );
      // The names of the sender and of the broadcast filter yield to the parameters too.
      expect(main).toContain(
         "send: (_target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, target: string, filter: number, contents: boolean) =>",
      );
      expect(main).toContain(
         "broadcastTo: (_filter: (contents: WebContents) => boolean, target: string, filter: number, contents: boolean) =>",
      );
      expect(main).toContain(
         "broadcastMessage('autoipc:senderClash', [target, filter, contents], _filter)",
      );
      // The event of sendToSender yields to a parameter of the signature as well.
      expect(main).toContain(
         "sendToSender: (_event: { readonly senderFrame: WebFrameMain | null }, event: string, frame: number) =>",
      );
      expect(main).toContain("sendToSenderFrame(_event, 'autoipc:frameClash', [event, frame])");
      expect(main).toContain(
         "(_event: IpcMainEvent, event: string, callback: number, args: boolean) => {",
      );
      expect(main).toContain("return _callback(_event, event, callback, args);");
      expect(main).toContain(
         "on: (callback: (event: IpcMainEvent) => void, options?: IpcListenOptions)",
      );
   });

   it("inserts the event parameter after the type parameters of generic signatures", async () => {
      project = await runFixture("param-clashes");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "(callback: <T extends Parameters<(x: number) => void>>(event: IpcMainEvent, cb: T) => void, options?: IpcListenOptions)",
      );
      expect(main).toContain(
         "<T extends Parameters<(x: number) => void>>(event: IpcMainEvent, cb: T) => {",
      );
      expect(main).toContain("return callback(event, cb);");
      expect(main).toContain(
         "send: <T extends Parameters<(x: number) => void>>(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, cb: T) =>",
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
      expect(win.webContents.send).toHaveBeenCalledWith("autoipc:windowClash", 1, "two", true);

      const callback = vi.fn();
      ipc.handlerClash.on(callback);
      const [channel, listener] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe("autoipc:handlerClash");
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

describe("ipcAutomation, results that are Promises, thenables or both", () => {
   // Regression for T96: `Awaited<Promise<X>>` was reported as a Promise, and a handler of
   // `Promise<void> | void` was refused for a `send` channel.
   it("types a result of `Promise<X> | X`, `Awaited` and `PromiseLike` as a promise of X", async () => {
      project = await runFixture("promise-unions");
      const windowTypes = project.generated["window.d.ts"];

      const invokeOf = (channel: string) => {
         const lines = windowTypes.split("\n");
         return lines[lines.indexOf(`   ${channel}: {`) + 2].trim();
      };
      expect(invokeOf("lookup")).toBe(
         "invoke: (id: number) => Promise<Awaited<Promise<string> | string>>;",
      );
      expect(invokeOf("maybe")).toBe(
         "invoke: () => Promise<Awaited<Promise<string | null> | null>>;",
      );
      expect(invokeOf("awaited")).toBe("invoke: () => Promise<Awaited<Awaited<Promise<number>>>>;");
      expect(invokeOf("thenable")).toBe("invoke: () => Promise<Awaited<PromiseLike<boolean>>>;");
      expect(project.generated["main.ts"]).toContain("Promise<Awaited<Promise<string> | string>>");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("promise-unions");
      expect(await project.typecheck()).toBe("");
   });
});
