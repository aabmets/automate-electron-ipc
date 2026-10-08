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

   it("should write a port channel per Port channel, with the listeners of its port and its end", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain(
         "function createPortChannel(channel: string, wire: string, max: number): PortChannel {",
      );
      expect(output).toContain(
         "ports['vitestChannel'] = createPortChannel('vitestChannel', 'vitestChannel', 1000);",
      );
      expect(output).toContain(
         "ipcRenderer.on('vitestChannel', (event: IpcRendererEvent, key: unknown) => {\n   ports['vitestChannel'].pair(key, event.ports[0]);\n});",
      );
      expect(output).toContain(
         "ipcRenderer.on('vitestChannel:close', (_event: IpcRendererEvent, key: unknown) => {\n   ports['vitestChannel'].end(key);\n});",
      );
      expect(output).toContain(
         "contextBridge.exposeInMainWorld('ipc', {\n   vitestChannel: ports['vitestChannel'].api,\n});",
      );
      for (const member of ["send", "on", "onReady", "onClose", "onOverflow", "onConnection"]) {
         expect(output).toMatch(new RegExp(`^ {6}${member}: `, "m"));
      }
      expect(output).not.toMatch(/sendMessage|onMessage|getPortObject|PortObject/);
   });

   it("should queue the sends until the port is there, and tell the subscribers apart", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain("enqueue(queue, args, channel, max, overflow);");
      expect(output).toContain("enqueue(pending, args, channel, max, ownOverflow ?? overflow);");
      expect(output).toContain("for (const args of pending.items.splice(0)) {");
      expect(output).toContain("const listener = { callback };");
      expect(output).toContain("if (port === next) {");
   });

   it("should create each port channel with its name, wire name and maxQueue", async () => {
      const specs = shared.buildFileSpecs(
         { name: "bounded", kind: "Port", direction: "RendererToRenderer", maxQueue: 5 },
         { name: "none", kind: "Port", direction: "MainToRenderer", maxQueue: 0 },
         {
            name: "unbounded",
            kind: "Port",
            direction: "RendererToRenderer",
            maxQueue: Number.POSITIVE_INFINITY,
         },
         { name: "plain", kind: "Port", direction: "MainToRenderer" },
      );
      const obj = new shared.VitestPreloadBindingsWriter(specs, { channelPrefix: "app:" });
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "ports['bounded'] = createPortChannel('bounded', 'app:bounded', 5);",
      );
      expect(output).toContain("ports['none'] = createPortChannel('none', 'app:none', 0);");
      expect(output).toContain(
         "ports['unbounded'] = createPortChannel('unbounded', 'app:unbounded', Infinity);",
      );
      expect(output).toContain("ports['plain'] = createPortChannel('plain', 'app:plain', 1000);");
   });

   it("should hand the new message but not the queue to the overflow callback of the page", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "action = overflow(args, { channel, max, dropped: before, warnings: queue.warnings });",
      );
      expect(output).not.toMatch(/overflow\([^)]*queue\.items/);
   });

   it("should keep a connection per key, and end one through the main process", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain("const connections = new Map<string, PortConnection>();");
      expect(output).toContain("onConnection: (callback: Function) => {");
      expect(output).toContain("close: () => {");
      expect(output).toContain("ipcRenderer.send(`${wire}:disconnect`, key);");
   });

   it("should give a mainPort channel the same page API as a port channel", async () => {
      const render = async (direction: "RendererToRenderer" | "MainToRenderer") => {
         const specs = shared.buildFileSpecs({ name: "alpha", kind: "Port", direction });
         const obj = new shared.VitestPreloadBindingsWriter(specs);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      expect(await render("MainToRenderer")).toStrictEqual(await render("RendererToRenderer"));
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

   describe("channel prefix", () => {
      const channels = [
         { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
         { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" },
         { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "chatIt", kind: "Port", direction: "RendererToRenderer" },
      ] as const;
      const render = async (config: Partial<t.IPCResolvedConfig>) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("puts the prefix in front of every name that is passed to Electron", async () => {
         const output = await render({ channelPrefix: "app:" });

         expect(output).toContain("ipcRenderer.invoke('app:getIt', ...args)");
         expect(output).toContain("ipcRenderer.send('app:sendIt', ...args)");
         expect(output).toContain("ipcRenderer.on('app:pushIt', listener);");
         expect(output).toContain("ipcRenderer.once('app:pushIt', listener);");
         expect(output).toContain("ipcRenderer.removeListener('app:pushIt', listener);");
         expect(output).toContain(
            "ipcRenderer.on('app:chatIt', (event: IpcRendererEvent, key: unknown) => {",
         );
         expect(output).toContain(
            "ipcRenderer.on('app:chatIt:close', (_event: IpcRendererEvent, key: unknown) => {",
         );
         expect(output).toContain(
            "ports['chatIt'] = createPortChannel('chatIt', 'app:chatIt', 1000);",
         );
         expect(output).toContain("ipcRenderer.send(`${wire}:disconnect`, key);");
      });

      it("keeps the names of the exposed api and of the port registry", async () => {
         const output = await render({ channelPrefix: "app:" });

         expect(output).toContain("\n   getIt: {");
         expect(output).toContain("chatIt: ports['chatIt'].api,");
         expect(output).toContain(
            "ports['chatIt'] = createPortChannel('chatIt', 'app:chatIt', 1000);",
         );
      });

      it("writes the names as they are without a prefix, and when the config has none", async () => {
         const bare = await render({ channelPrefix: "" });

         expect(bare).toContain("ipcRenderer.invoke('getIt', ...args)");
         expect(await render({})).toBe(bare);
      });
   });

   describe("ask channels", () => {
      const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
      const askToo = { name: "askAlso", kind: "Unicast", direction: "MainToRenderer" } as const;
      const emit = { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" } as const;
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("exposes handle only, and listens for the questions of the channel", async () => {
         const output = await render([ask]);

         expect(output).toContain("\n   askIt: {\n      handle: (callback: Function) => {");
         expect(output).toContain("askHandlers['askIt'] = callback;");
         expect(output).toContain("if (askHandlers['askIt'] === callback) {");
         expect(output).toContain("delete askHandlers['askIt'];");
         expect(output).toContain(
            "ipcRenderer.on('askIt', (_event: unknown, id: unknown, ...args: any[]) => {",
         );
         expect(output).toContain("void answerAsk('askIt', 'askIt:reply', id, args);");
         expect(output).not.toContain("askIt: {\n      on:");
      });

      it("generates the answering code only when there is an ask", async () => {
         const emits = await render([emit]);

         expect(emits).not.toContain("answerAsk");
         expect(emits).not.toContain("askHandlers");
         expect(emits).not.toContain("toIpcError");
         expect(emits).toContain("on: (callback: Function) => {");
         const asks = await render([ask, emit]);
         expect(asks.match(/^async function answerAsk\(/gm)).toHaveLength(1);
         expect(asks.match(/^function toIpcError\(/gm)).toHaveLength(1);
         expect(asks).toContain("pushIt: {\n      on: (callback: Function) => {");
      });

      it("lists the listeners of the asks in name order, whatever the order of the schema", async () => {
         const output = await render([ask, askToo]);

         expect(output.indexOf("ipcRenderer.on('askAlso'")).toBeGreaterThan(-1);
         expect(output.indexOf("ipcRenderer.on('askAlso'")).toBeLessThan(
            output.indexOf("ipcRenderer.on('askIt'"),
         );
         expect(output).toBe(await render([askToo, ask]));
      });

      it("puts the prefix in front of the request and the reply channel", async () => {
         const output = await render([ask], { channelPrefix: "app:" });

         expect(output).toContain("ipcRenderer.on('app:askIt', ");
         expect(output).toContain("answerAsk('askIt', 'app:askIt:reply', id, args)");
         const bare = await render([ask], { channelPrefix: "" });
         expect(bare).toContain("answerAsk('askIt', 'askIt:reply', id, args)");
         expect(await render([ask], {})).toBe(bare);
      });

      it("is not changed by rawErrors, since the answer is always an envelope", async () => {
         expect(await render([ask], { rawErrors: true })).toBe(await render([ask]));
      });
   });
});
