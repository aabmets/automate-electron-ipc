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
import type * as t from "@types";
import { describe, expect, it } from "vitest";
import shared from "./shared.js";

describe("PreloadBindingsWriter", () => {
   shared.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("should write empty ipc object into exposeInMainWorld when pfsArray is empty", async () => {
      const obj = new shared.VitestPreloadBindingsWriter(
         { codeIndent: 3 } as t.IPCResolvedConfig,
         [],
      );
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge } from "electron";\n
         contextBridge.exposeInMainWorld('ipc', {});
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trim());
   });

   it("should write Unicast RendererToMain callables into exposeInMainWorld ipc object", async () => {
      const pfsArray = shared.getParsedFileSpecsArray({
         channelKind: "Unicast",
         channelDirection: "RendererToMain",
         channelListeners: [],
         paramType: "CustomType",
         paramRest: false,
         paramOptional: true,
         sigReturnType: "Promise<string>",
         sigCustomTypes: ["CustomType"],
      });
      const obj = new shared.VitestPreloadBindingsWriter(
         { codeIndent: 3 } as t.IPCResolvedConfig,
         pfsArray as t.ParsedFileSpecs[],
      );
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

   it("should write Broadcast RendererToMain callables into exposeInMainWorld ipc object", async () => {
      const pfsArray = shared.getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "RendererToMain",
         channelListeners: [],
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
         sigCustomTypes: [],
      });
      const obj = new shared.VitestPreloadBindingsWriter(
         { codeIndent: 3 } as t.IPCResolvedConfig,
         pfsArray as t.ParsedFileSpecs[],
      );
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

   it("should write Broadcast MainToRenderer callables into exposeInMainWorld ipc object", async () => {
      const pfsArray = shared.getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "MainToRenderer",
         channelListeners: [],
         paramType: "number",
         paramRest: true,
         paramOptional: false,
         sigReturnType: "Promise<CustomType>",
         sigCustomTypes: ["CustomType"],
      });
      const obj = new shared.VitestPreloadBindingsWriter(
         { codeIndent: 3 } as t.IPCResolvedConfig,
         pfsArray as t.ParsedFileSpecs[],
      );
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge, ipcRenderer } from "electron";
         
         contextBridge.exposeInMainWorld('ipc', {
            onVitestChannel: (callback: Function) => ipcRenderer.on('VitestChannel', (_event: any, ...args: any[]) => callback(...args)),
         });
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
