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
import scopes from "@src/scopes.js";
import utils from "@src/utils.js";
import writer from "@src/writer/index.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   describe("scopes", () => {
      const config = {
         codeIndent: 3,
         preloadBindingsFilePath: "/p/ipc/preload.ts",
      } as t.IPCResolvedConfig;
      const targetOf = (scope: string | null) =>
         (
            new writer.PreloadBindingsWriter(config, [], scope) as unknown as {
               getTargetFilePath(): string;
            }
         ).getTargetFilePath();
      const channels = shared.buildFileSpecs(
         { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
         { name: "sendIt", kind: "Broadcast", direction: "RendererToMain", scopes: ["settings"] },
      );
      const render = async (pfsArray: t.ParsedFileSpecs[], scope: string | null) => {
         const obj = new shared.VitestPreloadBindingsWriter(pfsArray, {}, scope);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("writes the file of the surface of no scope to the usual path", () => {
         expect(targetOf(null)).toBe("/p/ipc/preload.ts");
      });

      it("writes the file of a scope next to it, named after the scope", () => {
         expect(targetOf("settings")).toBe("/p/ipc/preload.settings.ts");
         expect(targetOf("plugin-host")).toBe("/p/ipc/preload.plugin-host.ts");
      });

      it("writes the code of the channels it is given, whatever the scope is", async () => {
         const surface = scopes.filterByScope(channels, "settings");

         expect(await render(surface, "settings")).toStrictEqual(await render(surface, null));
         expect(await render(surface, "settings")).toContain("   sendIt: {");
      });

      it("writes only the channels of the surface of the scope", async () => {
         const none = await render(scopes.filterByScope(channels, null), null);
         const settings = await render(scopes.filterByScope(channels, "settings"), "settings");
         const editor = await render(scopes.filterByScope(channels, "editor"), "editor");

         expect(none).toContain("   getIt: {");
         expect(none).not.toContain("sendIt");
         expect(settings).toContain("   getIt: {");
         expect(settings).toContain("   sendIt: {");
         expect(editor).toContain("   getIt: {");
         expect(editor).not.toContain("sendIt");
      });

      it("writes the empty API for a scope whose surface has no channel", async () => {
         const output = await render([], "empty");
         expect(output).toContain("export const api = {};");
         expect(output).toContain("expose();");
      });
   });

   describe("getPathForFile", () => {
      const channels = shared.buildFileSpecs(
         { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
         { name: "zed", kind: "Broadcast", direction: "RendererToMain" },
      );
      const render = async (
         pfsArray: t.ParsedFileSpecs[],
         config: Partial<t.IPCResolvedConfig>,
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(pfsArray, config);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const HELPER = "getPathForFile: (file: File): string => webUtils.getPathForFile(file),";

      it("adds nothing when the config says nothing, or says false", async () => {
         const output = await render(channels, {});
         expect(output).not.toContain("getPathForFile");
         expect(output).not.toContain("webUtils");
         expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
         expect(await render(channels, { getPathForFile: false })).toBe(output);
      });

      it("imports webUtils, and puts the helper among the members, in name order", async () => {
         const output = await render(channels, { getPathForFile: true });
         expect(output).toContain(
            'import { contextBridge, ipcRenderer, webUtils } from "electron";',
         );
         const exposed = output.slice(output.indexOf("export const api"));
         expect([...exposed.matchAll(/^ {3}(\w+): /gm)].map((match) => match[1])).toStrictEqual([
            "getIt",
            "getPathForFile",
            "zed",
         ]);
         expect(output).toContain(`\n   ${HELPER}\n`);
         expect(output.match(/webUtils\.getPathForFile/g)).toHaveLength(1);
      });

      it("adds the helper to the empty API as well", async () => {
         expect(await render([], { getPathForFile: true, autoExpose: false })).toBe(
            [
               'import { contextBridge, webUtils } from "electron";',
               "",
               "export const api = {",
               `   ${HELPER}`,
               "};",
               "",
               "export function expose(key = 'ipc'): void {",
               "   contextBridge.exposeInMainWorld(key, api);",
               "}",
            ].join("\n"),
         );
      });

      it("adds the helper to the empty API of a schema that has only utility channels", async () => {
         const utilityOnly = shared.buildFileSpecs({
            name: "work",
            kind: "Unicast",
            direction: "MainToUtility",
         });
         const output = await render(utilityOnly, { getPathForFile: true });
         expect(output).toContain("export const api = {\n   getPathForFile:");
         expect(output).toContain('import { contextBridge, webUtils } from "electron";');
      });

      it("adds the helper to the file of every scope", async () => {
         const scoped = shared.buildFileSpecs({
            name: "sendIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            scopes: ["settings"],
         });
         const obj = new shared.VitestPreloadBindingsWriter(
            scoped,
            { getPathForFile: true },
            "settings",
         );
         await obj.write(false);
         expect((await fsp.readFile(obj.getTargetFilePath())).toString()).toContain(HELPER);
      });

      it("uses nothing of this library at runtime", async () => {
         const output = await render(channels, { getPathForFile: true });
         expect(output).not.toContain("automate-electron-ipc");
      });
   });

   describe("exposure of the API", () => {
      const channels = shared.buildFileSpecs({
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
      });
      const render = async (
         pfsArray: t.ParsedFileSpecs[],
         config: Partial<t.IPCResolvedConfig>,
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(pfsArray, config);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const EXPOSE = (key: string) =>
         `export function expose(key = '${key}'): void {\n   contextBridge.exposeInMainWorld(key, api);\n}`;

      it("exports the API as `api`, and exposes it in the main world as 'ipc' by default", async () => {
         const output = await render(channels, {});
         expect(output).toContain("export const api = {\n   getIt: {");
         expect(output).toContain(EXPOSE("ipc"));
         expect(output.endsWith("}\n\nexpose();\n")).toBe(true);
         expect(output).not.toContain("exposeInIsolatedWorld");
      });

      it("exposes the API under the key of `exposeAs`", async () => {
         const output = await render(channels, { exposeAs: "api" });
         expect(output).toContain(EXPOSE("api"));
         expect(output).not.toContain("'ipc'");
      });

      it("exposes the API in the isolated world of `isolatedWorldId`", async () => {
         const output = await render(channels, { exposeAs: "bridge", isolatedWorldId: 1004 });
         expect(output).toContain(
            "export function expose(key = 'bridge'): void {\n   contextBridge.exposeInIsolatedWorld(1004, key, api);\n}",
         );
         expect(output).not.toContain("exposeInMainWorld");
      });

      it("calls `expose()` once, after the declaration of `expose`", async () => {
         const output = await render(channels, {});
         expect(output.match(/^expose\(\);$/gm)).toHaveLength(1);
         expect(output.indexOf("expose();")).toBeGreaterThan(
            output.indexOf("export function expose"),
         );
      });

      it("leaves the call out when `autoExpose` is false, and still exports `api` and `expose`", async () => {
         const output = await render(channels, { autoExpose: false, exposeAs: "bridge" });
         expect(output).toContain("export const api = {\n   getIt: {");
         expect(output).toContain(EXPOSE("bridge"));
         expect(output).not.toMatch(/^expose\(\);$/m);
         expect(output.endsWith("}\n")).toBe(true);
      });

      it("exposes with `autoExpose` true as it does without the option", async () => {
         expect(await render(channels, { autoExpose: true })).toBe(await render(channels, {}));
      });

      it("keeps the world of the config when `autoExpose` is false", async () => {
         const output = await render(channels, { autoExpose: false, isolatedWorldId: 2000 });
         expect(output).toContain("contextBridge.exposeInIsolatedWorld(2000, key, api);");
         expect(output).not.toMatch(/^expose\(\);$/m);
      });

      it("exposes the empty API the same way", async () => {
         expect(await render([], { exposeAs: "api" })).toBe(
            [
               'import { contextBridge } from "electron";',
               "",
               "export const api = {};",
               "",
               EXPOSE("api"),
               "",
               "expose();",
            ].join("\n"),
         );
         expect(await render([], { isolatedWorldId: 2000, autoExpose: false })).toBe(
            [
               'import { contextBridge } from "electron";',
               "",
               "export const api = {};",
               "",
               "export function expose(key = 'ipc'): void {",
               "   contextBridge.exposeInIsolatedWorld(2000, key, api);",
               "}",
            ].join("\n"),
         );
      });
   });

   it("should write an empty api object that is exposed when pfsArray is empty", async () => {
      const obj = new shared.VitestPreloadBindingsWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { contextBridge } from "electron";\n
         export const api = {};\n
         export function expose(key = 'ipc'): void {
            contextBridge.exposeInMainWorld(key, api);
         }\n
         expose();
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
         
         export const api = {
            vitestChannel: {
               invoke: async (...args: any[]) => {
                  const result = await ipcRenderer.invoke('vitestChannel', ...args);
                  if (result.ok) {
                     return result.value;
                  }
                  throw result.error;
               },
            },
         };

         export function expose(key = 'ipc'): void {
            contextBridge.exposeInMainWorld(key, api);
         }

         expose();
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
         
         export const api = {
            vitestChannel: {
               send: (...args: any[]) => ipcRenderer.send('vitestChannel', ...args),
            },
         };

         export function expose(key = 'ipc'): void {
            contextBridge.exposeInMainWorld(key, api);
         }

         expose();
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
         
         export const api = {
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
         };

         export function expose(key = 'ipc'): void {
            contextBridge.exposeInMainWorld(key, api);
         }

         expose();
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
         "export const api = {\n   vitestChannel: ports['vitestChannel'].api,\n};",
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

      const exposed = output.slice(output.indexOf("export const api"));
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

   describe("utility process timeouts", () => {
      const invokeUtility = {
         name: "queryRows",
         kind: "Unicast",
         direction: "RendererToUtility",
      } as const;
      const streamUtility = {
         name: "scanRows",
         kind: "Stream",
         direction: "RendererToUtility",
         returnType: "AsyncIterable<number>",
      } as const;
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

      it("passes the timeout of a call as the last argument, and none without one", async () => {
         const output = await render([
            { ...invokeUtility, timeoutMs: 1200 },
            { ...invokeUtility, name: "patient", timeoutMs: 0 },
            { ...invokeUtility, name: "plain" },
         ]);

         expect(output).toContain("callUtilityPort(utilityClients['queryRows'], args, 1200)");
         expect(output).toContain("callUtilityPort(utilityClients['patient'], args)");
         expect(output).toContain("callUtilityPort(utilityClients['plain'], args)");
      });

      it("applies the default of the config to a call, but not to a stream", async () => {
         const output = await render([invokeUtility, streamUtility], { timeoutMs: 2500 });

         expect(output).toContain("callUtilityPort(utilityClients['queryRows'], args, 2500)");
         expect(output).toMatch(/openUtilityStream\(utilityClients\['scanRows'\], args, \d+\)/);
      });

      it("passes the timeout of a stream after its window", async () => {
         const output = await render([{ ...streamUtility, highWaterMark: 4, timeoutMs: 700 }]);

         expect(output).toContain("openUtilityStream(utilityClients['scanRows'], args, 4, 700)");
      });

      it("cancels a stream in the child when it times out", async () => {
         const output = await render([{ ...streamUtility, timeoutMs: 700 }]);

         expect(output).toContain("'IPC_UTILITY_TIMEOUT'");
         expect(output).toContain("timeoutMs = 0) {");
         expect(output).toContain(
            "client.port?.postMessage({ __ipc: 'cancel', channel: client.channel, id });",
         );
      });

      it("does not write withTimeout, which is only for the invoke of the main process", async () => {
         const output = await render([invokeUtility], { timeoutMs: 2500 });

         expect(output).not.toContain("withTimeout");
         expect(output).not.toContain("IpcTimeoutError");
      });
   });

   describe("invoke timeouts", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const other = { name: "getOther", kind: "Unicast", direction: "RendererToMain" } as const;
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

      it("generates nothing for a channel without a timeout", async () => {
         const output = await render([unicast]);

         expect(output).not.toContain("withTimeout");
         expect(output).not.toContain("IpcTimeoutError");
         expect(output).toBe(await render([unicast], { timeoutMs: 0 }));
      });

      it("races the invoke of a channel with the timeoutMs option", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }, other]);

         expect(output).toContain(
            "const result = await withTimeout('getIt', 500, ipcRenderer.invoke('getIt', ...args));",
         );
         expect(output).toContain("const result = await ipcRenderer.invoke('getOther', ...args);");
         expect(output).toContain("function withTimeout<T>(channel: string, timeoutMs: number");
      });

      it("rejects with the plain object of the timeout error, not with an Error", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }]);

         expect(output).toContain(
            "reject({ name: 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' });",
         );
         expect(output).not.toContain("new Error");
      });

      it("clears the timer when the call settles, and caps it at what a timer holds", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }]);

         expect(output.match(/clearTimeout\(timer\)/g)).toHaveLength(2);
         expect(output).toContain("Math.min(timeoutMs, 2147483647)");
      });

      it("applies the timeout of the config to every invoke", async () => {
         const output = await render([unicast, other, broadcast], { timeoutMs: 2500 });

         expect(output).toContain(
            "withTimeout('getIt', 2500, ipcRenderer.invoke('getIt', ...args))",
         );
         expect(output).toContain(
            "withTimeout('getOther', 2500, ipcRenderer.invoke('getOther', ...args))",
         );
         expect(output).toContain("send: (...args: any[]) => ipcRenderer.send('sendIt', ...args),");
         expect(output.match(/function withTimeout/g)).toHaveLength(1);
      });

      it("lets the option override the config, and 0 turn the timeout off", async () => {
         const output = await render(
            [
               { ...unicast, timeoutMs: 100 },
               { ...other, timeoutMs: 0 },
            ],
            {
               timeoutMs: 2500,
            },
         );

         expect(output).toContain("withTimeout('getIt', 100,");
         expect(output).toContain("const result = await ipcRenderer.invoke('getOther', ...args);");
      });

      it("races the raw invoke when rawErrors is set", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }], { rawErrors: true });

         expect(output).toContain(
            "invoke: (...args: any[]) => withTimeout('getIt', 500, ipcRenderer.invoke('getIt', ...args)),",
         );
      });

      it("times the wire name, which carries the prefix", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }], { channelPrefix: "app:" });

         expect(output).toContain(
            "withTimeout('getIt', 500, ipcRenderer.invoke('app:getIt', ...args))",
         );
      });

      it("ignores the timeout for send and ask channels", async () => {
         const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
         const output = await render([broadcast, ask], { timeoutMs: 2500 });

         expect(output).not.toContain("withTimeout");
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
   describe("stream channels", () => {
      const rows = {
         name: "exportRows",
         kind: "Stream",
         direction: "RendererToMain",
         params: ["table: string"],
         returnType: "AsyncIterable<Row>",
      } as const;
      const tokens = {
         name: "tokens",
         kind: "Stream",
         direction: "RendererToMain",
         returnType: "AsyncIterable<string>",
      } as const;
      const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
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

      it("exposes stream only, which opens a stream of the channel", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "\n   exportRows: {\n      stream: (...args: any[]) => openStream('exportRows', 'exportRows', args, 1024),\n   },",
         );
         expect(output).not.toContain("exportRows: {\n      invoke:");
      });

      it("passes the window of the channel to the stream: 1024 chunks, or the highWaterMark", async () => {
         const windowed = { ...rows, name: "windowed", highWaterMark: 4 };
         const pulled = { ...rows, name: "pulled", highWaterMark: 0 };
         const unbounded = { ...rows, name: "unbounded", highWaterMark: Number.POSITIVE_INFINITY };
         const output = await render([rows, windowed, pulled, unbounded]);

         for (const [name, window] of [
            ["exportRows", "1024"],
            ["windowed", "4"],
            ["pulled", "0"],
            ["unbounded", "Infinity"],
         ]) {
            expect(output).toContain(`openStream('${name}', '${name}', args, ${window})`);
         }
      });

      it("grants credits from the reader, and only to a port that can be posted to", async () => {
         const output = await render([rows]);

         expect(output).toContain("highWaterMark: number, grant: (limit: number) => boolean");
         expect(output).toContain("port.postMessage({ type: 'credit', limit });");
         expect(output).toContain("Math.max(1, Math.ceil(highWaterMark / 2))");
         expect(output).toContain("reader.topUp();");
      });

      it("listens for the ports of the calls of every channel, in name order", async () => {
         const output = await render([tokens, rows]);

         expect(output).toContain("listenForStreamPorts('exportRows:port');");
         expect(output.indexOf("listenForStreamPorts('exportRows:port')")).toBeLessThan(
            output.indexOf("listenForStreamPorts('tokens:port')"),
         );
         expect(output).toBe(await render([rows, tokens]));
         expect(output.match(/^function openStream\(/gm)).toHaveLength(1);
         expect(output.match(/^function listenForStreamPorts\(/gm)).toHaveLength(1);
      });

      it("calls the main process with invoke, the ID in front of the arguments", async () => {
         const output = await render([rows]);

         expect(output).toContain("ipcRenderer.invoke(wire, id, ...args).then(");
         expect(output).toContain("[Symbol.asyncIterator]: () => stream,");
      });

      it("sends the cancel message and closes the port, and fails a port which closes early", async () => {
         const output = await render([rows]);

         expect(output).toContain("() => port?.postMessage({ type: 'cancel' }),");
         expect(output).toContain("code: 'IPC_STREAM_CLOSED'");
         expect(output).toContain("code: 'IPC_STREAM_INVALID_REPLY'");
      });

      it("shares the error helpers with the ask channels, which are declared once", async () => {
         const both = await render([rows, ask]);

         expect(both.match(/^function toIpcError\(/gm)).toHaveLength(1);
         expect(both.match(/^interface IpcErrorInfo \{/gm)).toHaveLength(1);
         expect(both).toContain("async function answerAsk(");
         expect(both).toContain("function openStream(");
         const streams = await render([rows]);
         expect(streams).toContain("function toIpcError(");
         expect(streams).not.toContain("answerAsk");
         expect(streams).not.toContain("askHandlers");
      });

      it("generates nothing of streams for the other channels", async () => {
         const output = await render([ask]);

         expect(output).not.toContain("openStream");
         expect(output).not.toContain("listenForStreamPorts");
      });

      it("puts the prefix in front of the request and the port channel only", async () => {
         const output = await render([rows], { channelPrefix: "app:" });

         expect(output).toContain("openStream('exportRows', 'app:exportRows', args, 1024)");
         expect(output).toContain("listenForStreamPorts('app:exportRows:port');");
         const bare = await render([rows], { channelPrefix: "" });
         expect(bare).toContain("openStream('exportRows', 'exportRows', args, 1024)");
         expect(await render([rows], {})).toBe(bare);
      });

      it("is not changed by rawErrors, since the call is always answered with an envelope", async () => {
         expect(await render([rows], { rawErrors: true })).toBe(await render([rows]));
      });
   });
});

describe("PreloadBindingsWriter, utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels));
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const utility: shared.SimpleChannel[] = [
      { name: "indexFile", kind: "Unicast", direction: "MainToUtility" },
      { name: "setLevel", kind: "Broadcast", direction: "MainToUtility" },
      { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" },
      { name: "progress", kind: "Broadcast", direction: "UtilityToMain" },
   ];

   it("writes the empty script when only utility channels are declared", async () => {
      const empty = await render();

      expect(await render(...utility)).toStrictEqual(empty);
      expect(empty).not.toContain("ipcRenderer");
   });

   it("leaves the utility channels out when renderer channels are declared as well", async () => {
      const alone = await render({ name: "getUser", kind: "Unicast", direction: "RendererToMain" });
      const mixed = await render(
         { name: "getUser", kind: "Unicast", direction: "RendererToMain" },
         ...utility,
      );

      expect(mixed).toStrictEqual(alone);
      for (const { name } of utility) {
         expect(mixed).not.toContain(name);
      }
   });
});

describe("PreloadBindingsWriter, renderer to utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const invokeUtility = {
      name: "queryRows",
      kind: "Unicast",
      direction: "RendererToUtility",
      params: ["sql: string"],
      returnType: "Promise<number>",
   } as const;
   const streamUtility = {
      name: "scanRows",
      kind: "Stream",
      direction: "RendererToUtility",
      returnType: "AsyncIterable<number>",
   } as const;
   const mainStream = {
      name: "exportRows",
      kind: "Stream",
      direction: "RendererToMain",
      returnType: "AsyncIterable<number>",
   } as const;

   it("exposes invoke and stream, which call the client of the channel", async () => {
      const output = await render(streamUtility, invokeUtility);

      expect(output).toContain(
         "\n   queryRows: {\n      invoke: (...args: any[]) => callUtilityPort(utilityClients['queryRows'], args),\n   },",
      );
      expect(output).toContain(
         "\n   scanRows: {\n      stream: (...args: any[]) => openUtilityStream(utilityClients['scanRows'], args, 1024),\n   },",
      );
   });

   it("passes the window of the channel to the client of a stream, and grants credits to the child", async () => {
      const windowed = { ...streamUtility, name: "windowed", highWaterMark: 4 };
      const unbounded = {
         ...streamUtility,
         name: "unbounded",
         highWaterMark: Number.POSITIVE_INFINITY,
      };
      const output = await render(streamUtility, windowed, unbounded);

      for (const [name, window] of [
         ["scanRows", "1024"],
         ["windowed", "4"],
         ["unbounded", "Infinity"],
      ]) {
         expect(output).toContain(`openUtilityStream(utilityClients['${name}'], args, ${window})`);
      }
      expect(output).toContain("{ __ipc: 'credit', channel: client.channel, id, limit }");
   });

   it("listens for the port and the close of each channel, on the wire names, sorted", async () => {
      const output = await render(streamUtility, invokeUtility);

      expect(output).toContain(
         "function listenForUtilityPorts(name: string, channel: string): void {",
      );
      expect(output).toContain("ipcRenderer.on(`${channel}:close`,");
      const listeners = [...output.matchAll(/^listenForUtilityPorts\((.*)\);$/gm)].map((m) => m[1]);
      expect(listeners).toStrictEqual([
         "'queryRows', 'autoipc:queryRows'",
         "'scanRows', 'autoipc:scanRows'",
      ]);
   });

   it("writes the stream parts only when a stream channel is declared", async () => {
      const calls = await render(invokeUtility);
      const streams = await render(streamUtility);

      expect(calls).toContain("function callUtilityPort(");
      for (const name of ["openUtilityStream", "createStreamReader", "StreamResult"]) {
         expect(calls).not.toContain(name);
      }
      expect(streams).toContain("function openUtilityStream(");
      expect(streams).toContain("function createStreamReader(");
      expect(streams).toContain("function callUtilityPort(");
   });

   it("writes the error helpers once, and the reader once when both kinds of stream are declared", async () => {
      const output = await render(streamUtility, mainStream, invokeUtility);

      expect(output.match(/^function toIpcError\(/gm)).toHaveLength(1);
      expect(output.match(/^function createStreamReader\(/gm)).toHaveLength(1);
      expect(output).toContain("function openStream(");
      expect(output).toContain("function openUtilityStream(");
   });

   it("needs no stream of the main process, and imports nothing else of electron", async () => {
      const output = await render(invokeUtility);

      expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
      expect(output).not.toContain("IpcRendererEvent");
      expect(output).not.toContain("openStream");
      expect(output).not.toContain("withTimeout");
   });

   it("writes the stream of the main process on the reader that the streams share", async () => {
      const output = await render(mainStream);

      expect(output).toContain("const reader = createStreamReader(");
      expect(output).toContain("return reader.stream;");
      expect(output).not.toContain("utilityClients");
   });
});
