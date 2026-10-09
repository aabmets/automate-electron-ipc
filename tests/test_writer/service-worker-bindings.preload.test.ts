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

import fsp from "node:fs/promises";
import { all, invokeFromWorker, renderer } from "@testutils/service-worker-writer-utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("ServiceWorkerPreloadWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestServiceWorkerPreloadWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestServiceWorkerPreloadWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels only when the schema has a channel to or from a service worker", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestServiceWorkerPreloadWriter(
            shared.buildFileSpecs(...channels),
         ).hasChannels();

      expect(has()).toBe(false);
      expect(has(renderer)).toBe(false);
      for (const channel of all) {
         expect(has(renderer, channel)).toBe(true);
      }
   });

   it("writes the API of a page for the channels of the worker, and leaves the others out", async () => {
      const output = await render([...all, renderer]);

      expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
      expect(output).toContain("ipcRenderer.invoke('autoipc:getToken', ...args)");
      expect(output).toContain(
         "send: (...args: any[]) => ipcRenderer.send('autoipc:syncDone', ...args),",
      );
      expect(output).toContain(
         "on: (callback: Function) => {\n         return listenToChannel('autoipc:configChanged', callback, false);",
      );
      expect(output).toContain("handle: (callback: Function) => {");
      expect(output).toContain(
         "ipcRenderer.on('autoipc:flush', (_event: unknown, id: unknown, ...args: any[]) => {",
      );
      expect(output).toContain("void answerAsk('flush', 'autoipc:flush:reply', id, args);");
      const names = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(names).toStrictEqual(["configChanged", "flush", "getToken", "syncDone"]);
      expect(output).not.toContain("getUser");
   });

   it("exposes the API under the exposeAs key, in the world of the worker", async () => {
      const output = await render([invokeFromWorker], {
         exposeAs: "workerIpc",
         isolatedWorldId: 1001,
      });

      expect(output).toContain("export function expose(key = 'workerIpc'): void {");
      expect(output).toContain("contextBridge.exposeInMainWorld(key, api);");
      expect(output).not.toContain("exposeInIsolatedWorld");
      expect(output).toMatch(/\nexpose\(\);\n$/);
   });

   it("leaves the exposing to the app with autoExpose off", async () => {
      const output = await render([invokeFromWorker], { autoExpose: false });
      expect(output).toContain("export function expose(");
      expect(output).not.toMatch(/\nexpose\(\);/);
   });

   it("has no helper for files, which belongs to pages", async () => {
      const output = await render([invokeFromWorker], { getPathForFile: true });
      expect(output).not.toContain("webUtils");
      expect(output).not.toContain("getPathForFile");
   });

   it("has no timer, which the preload script of a worker could not run", async () => {
      const output = await render(
         [
            { ...invokeFromWorker, timeoutMs: 800 },
            { ...invokeFromWorker, name: "defaulted" },
         ],
         { timeoutMs: 5000 },
      );
      expect(output).not.toContain("withTimeout");
      expect(output).not.toContain("setTimeout");
      expect(output).toContain("ipcRenderer.invoke('autoipc:getToken', ...args)");
   });

   it("does not unwrap the envelope with rawErrors", async () => {
      const output = await render([invokeFromWorker], { rawErrors: true });
      expect(output).toContain(
         "invoke: (...args: any[]) => ipcRenderer.invoke('autoipc:getToken', ...args),",
      );
   });
});

describe("PreloadBindingsWriter, calls of a worker", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("leaves the timeout of a worker call out of the preload script of the page", async () => {
      const obj = new shared.VitestPreloadBindingsWriter(
         shared.buildFileSpecs(renderer, { ...invokeFromWorker, timeoutMs: 800 }),
         { channelPrefix: "autoipc:" },
      );
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).not.toContain("withTimeout");
      expect(output).not.toContain("getToken");
   });
});
