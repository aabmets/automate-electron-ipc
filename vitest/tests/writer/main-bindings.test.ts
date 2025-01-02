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

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   it("should write empty ipcMain object when pfsArray is empty", async () => {
      const obj = new shared.VitestMainBindingsWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = "\nexport const ipcMain = {};";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into ipcMain object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainEvent } from "electron";
         
         export const ipcMain = {
            onVitestChannel: (callback: (event: IpcMainEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>) => 
               electronIpcMain.handle('VitestChannel', (event: any, ...args: any[]) => (callback as any)(event, ...args)),
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast RendererToMain callables into ipcMain object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainEvent } from "electron";

         export const ipcMain = {
            onCustomListener1: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) => 
               electronIpcMain.on('VitestChannel', (event: any, ...args: any[]) => (callback as any)(event, ...args)),
            onCustomListener2: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) => 
               electronIpcMain.on('VitestChannel', (event: any, ...args: any[]) => (callback as any)(event, ...args)),
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast MainToRenderer callables into ipcMain object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainEvent, BrowserWindow } from "electron";
         
         export const ipcMain = {
            sendVitestChannel: (browserWindow: BrowserWindow, arg1: number, ...arg2: number) => 
               browserWindow.webContents.send('VitestChannel', arg1, arg2),
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
