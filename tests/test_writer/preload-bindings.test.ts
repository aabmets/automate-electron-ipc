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
import type * as t from "@types";
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
            vitestChannel: {
               invoke: async (...args: any[]) => {
                  const result = await ipcRenderer.invoke('vitestChannel', ...args);
                  if (result.ok) {
                     return result.value;
                  }
                  throw result.error;
               },
            },
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
            vitestChannel: {
               send: (...args: any[]) => ipcRenderer.send('vitestChannel', ...args),
            },
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
            vitestChannel: {
               on: (callback: Function) => {
                  const listener = (_event: any, ...args: any[]) => callback(...args);
                  ipcRenderer.on('vitestChannel', listener);
                  return () => {
                     ipcRenderer.removeListener('vitestChannel', listener);
                  };
               },
               once: (callback: Function) => {
                  const listener = (_event: any, ...args: any[]) => callback(...args);
                  ipcRenderer.once('vitestChannel', listener);
                  return () => {
                     ipcRenderer.removeListener('vitestChannel', listener);
                  };
               },
            },
         });
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write a port object per Port channel, with its initializer", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain("type PortObject = { send: Function, on: Function };");
      expect(output).toContain("send: (...args: any[]) => ports[portName].postMessage(args),");
      expect(output).toContain("on: (callback: Function) => {");
      expect(output).toContain("ports.vitestChannel = event.ports[0];");
      expect(output).toContain(
         "contextBridge.exposeInMainWorld('ipc', {\n   vitestChannel: getPortObject('vitestChannel'),\n});",
      );
      expect(output).not.toMatch(/sendMessage|onMessage|\bports: \{$/m);
   });

   it("should write one object per channel, sorted by name, next to the port objects", async () => {
      const pfsArray = shared.buildFileSpecs(
         { name: "zeta", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "alpha", kind: "Port", direction: "RendererToRenderer" },
         { name: "Beta", kind: "Unicast", direction: "RendererToMain" },
         { name: "gamma", kind: "Broadcast", direction: "RendererToMain" },
      );
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      const exposed = output.slice(output.indexOf("exposeInMainWorld"));
      expect([...exposed.matchAll(/^ {3}(\w+): /gm)].map((match) => match[1])).toStrictEqual([
         "Beta",
         "alpha",
         "gamma",
         "zeta",
      ]);
      expect(exposed).toContain("Beta: {\n      invoke: async (...args: any[]) => {");
      expect(exposed).toContain("gamma: {\n      send: (...args: any[]) =>");
      expect(exposed).toContain("zeta: {\n      on: (callback: Function) => {");
   });

   describe("error envelope", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
      const render = async (
         channels: shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("unwraps the envelope of an invoke, and rejects with the error object", async () => {
         const output = await render([unicast]);

         expect(output).toContain("const result = await ipcRenderer.invoke('getIt', ...args);");
         expect(output).toContain("if (result.ok) {\n            return result.value;\n         }");
         expect(output).toContain("throw result.error;");
      });

      it("does not wrap the error in an Error, which contextBridge would strip of its fields", async () => {
         const output = await render([unicast]);

         expect(output).not.toContain("new Error");
         expect(output).not.toContain("class ");
      });

      it("forwards the reply untouched when rawErrors is set", async () => {
         const output = await render([unicast], { rawErrors: true });

         expect(output).toContain(
            "invoke: (...args: any[]) => ipcRenderer.invoke('getIt', ...args),",
         );
         expect(output).not.toContain("result");
      });

      it("leaves send channels as they are", async () => {
         const output = await render([broadcast]);

         expect(output).toContain("send: (...args: any[]) => ipcRenderer.send('sendIt', ...args),");
         expect(output).not.toContain("result");
      });
   });
});
