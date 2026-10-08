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
import utils from "@src/utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("should write empty ipc object into exposeInMainWorld when pfsArray is empty", async () => {
      const obj = new shared.VitestPreloadBindingsWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge } from "electron";\n
         contextBridge.exposeInMainWorld('ipc', {});
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trim());
   });

   it("should write Unicast RendererToMain callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge, ipcRenderer } from "electron";
         
         contextBridge.exposeInMainWorld('ipc', {
            sendVitestChannel: (...args: any[]) => ipcRenderer.invoke('VitestChannel', ...args),
         });
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast RendererToMain callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge, ipcRenderer } from "electron";
         
         contextBridge.exposeInMainWorld('ipc', {
            sendVitestChannel: (...args: any[]) => ipcRenderer.send('VitestChannel', ...args),
         });
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast MainToRenderer callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge, ipcRenderer } from "electron";
         
         contextBridge.exposeInMainWorld('ipc', {
            onCustomListener1: (callback: Function) => ipcRenderer.on('VitestChannel', (_event: any, ...args: any[]) => callback(...args)),
            onCustomListener2: (callback: Function) => ipcRenderer.on('VitestChannel', (_event: any, ...args: any[]) => callback(...args)),
         });
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
