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
      const expectedOutput = "export const ipcMain = {};";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into ipcMain object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainInvokeEvent } from "electron";
         
         export const ipcMain = {
            onVitestChannel: (callback: (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>) => 
               electronIpcMain.handle('vitestChannel', (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => callback(event, arg1, arg2)),
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
            onVitestChannel: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) => 
               electronIpcMain.on('vitestChannel', (event: IpcMainEvent, arg1: string, arg2: string) => callback(event, arg1, arg2)),
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write one callable per listener name when a channel has listeners", async () => {
      const pfsArray = shared.withListeners(shared.vitestChannelSpecs.Broadcast_RendererToMain, [
         "onCustomListener1",
         "onCustomListener2",
      ]);
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain(
         "onCustomListener1: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) =>",
      );
      expect(output).toContain(
         "onCustomListener2: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) =>",
      );
      expect(output).not.toContain("onVitestChannel");
   });

   it("should write Broadcast MainToRenderer callables into ipcMain object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import type { BrowserWindow } from "electron";
         
         export const ipcMain = {
            sendVitestChannel: (browserWindow: BrowserWindow, arg1: number, ...arg2: number[]) => 
               browserWindow.webContents.send('vitestChannel', arg1, ...arg2),
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should import only the event types that the channels use", async () => {
      // Regression for B6: Unicast handlers get an IpcMainInvokeEvent, Broadcast ones an IpcMainEvent.
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;

      const both = await render(unicast, broadcast);
      expect(both).toContain('import type { IpcMainInvokeEvent, IpcMainEvent } from "electron";');
      const onlyUnicast = await render(unicast);
      expect(onlyUnicast).toContain('import type { IpcMainInvokeEvent } from "electron";');
      expect(onlyUnicast).not.toContain("IpcMainEvent");
      const none = await render();
      expect(none).not.toContain("import type");
   });

   it("should enforce the declared signature in the handler wrappers", async () => {
      const pfsArray = shared.buildFileSpecs(
         {
            name: "restIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            params: ["label: string", "flag?: boolean", "...rest: number[]"],
         },
         { name: "bareIt", kind: "Unicast", direction: "RendererToMain", returnType: "number" },
      );
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "electronIpcMain.on('restIt', (event: IpcMainEvent, label: string, flag?: boolean, ...rest: number[]) => callback(event, label, flag, ...rest))",
      );
      expect(output).toContain(
         "electronIpcMain.handle('bareIt', (event: IpcMainInvokeEvent) => callback(event))",
      );
      expect(output).not.toMatch(/\bany\b/);
   });

   it("should not shadow the callback or the event with parameters of the signature", async () => {
      const pfsArray = shared.buildFileSpecs({
         name: "clashIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         params: ["callback: string", "event: number"],
      });
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "onClashIt: (_callback: (_event: IpcMainEvent, callback: string, event: number) => void)",
      );
      expect(output).toContain(
         "(_event: IpcMainEvent, callback: string, event: number) => _callback(_event, callback, event)",
      );
   });

   it("should write an immediate sender and a separate binder for triggered channels", async () => {
      // Regression for B5: the sender used to register a window listener on every call.
      const pfsArray = shared.buildFileSpecs({
         name: "focused",
         kind: "Broadcast",
         direction: "MainToRenderer",
         params: ["state: boolean", "...tags: string[]"],
         trigger: "focus",
      });
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import type { BrowserWindow } from "electron";

         export const ipcMain = {
            sendFocused: (browserWindow: BrowserWindow, state: boolean, ...tags: string[]) =>
               browserWindow.webContents.send('focused', state, ...tags),
            bindFocused: (browserWindow: BrowserWindow, provider: () => [state: boolean, ...tags: string[]] | Promise<[state: boolean, ...tags: string[]]>, onError?: (error: unknown) => void) => {
               const listener = async () => {
                  try {
                     const args = await provider();
                     if (!browserWindow.isDestroyed()) {
                        browserWindow.webContents.send('focused', ...args);
                     }
                  } catch (error) {
                     (onError ?? console.error)(error);
                  }
               };
               browserWindow.on("focus", listener);
               return () => {
                  browserWindow.off("focus", listener);
               };
            },
         }
      `);
      // The sender arrow is followed by a newline and a trailing space in the generated code.
      const expected = expectedOutput
         .trimStart()
         .replace("...tags: string[]) =>\n", "...tags: string[]) => \n");
      expect(buffer.toString()).toStrictEqual(expected);
   });

   it("should write only ports into ipcMain object when there are no callables", async () => {
      // Regression for T52: the empty callables line left a lone comma in the object.
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      expect(buffer.toString()).toContain("export const ipcMain = {\n   ports: {");
      expect(buffer.toString()).not.toMatch(/\{\s*,/);
   });

   it("should import ipcMain from electron only for RendererToMain channels", async () => {
      // Regression for T65: the import was unused, and failed under noUnusedLocals, without them.
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const toRenderer = await render({
         name: "a",
         kind: "Broadcast",
         direction: "MainToRenderer",
      });
      const port = await render({ name: "p", kind: "Port", direction: "RendererToRenderer" });
      const toMain = await render({ name: "b", kind: "Broadcast", direction: "RendererToMain" });
      const both = await render(
         { name: "p", kind: "Port", direction: "RendererToRenderer" },
         { name: "b", kind: "Broadcast", direction: "RendererToMain" },
      );

      expect(toRenderer).not.toContain("electronIpcMain");
      expect(toRenderer.startsWith('import type { BrowserWindow } from "electron";')).toBe(true);
      expect(port).not.toContain("electronIpcMain");
      expect(port.startsWith('import { MessageChannelMain } from "electron";')).toBe(true);
      expect(toMain.startsWith('import { ipcMain as electronIpcMain } from "electron";')).toBe(
         true,
      );
      expect(
         both.startsWith("import { ipcMain as electronIpcMain, MessageChannelMain } from"),
      ).toBe(true);
   });
});
