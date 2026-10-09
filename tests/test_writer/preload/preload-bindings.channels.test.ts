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
import { dedent } from "@testutils/text-utils.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("should write an empty api object that is exposed when pfsArray is empty", async () => {
      const obj = new shared.VitestPreloadBindingsWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
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
      const expectedOutput = dedent(`
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
      const expectedOutput = dedent(`
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
      const expectedOutput = dedent(`
         import { contextBridge, ipcRenderer } from "electron";
         
         interface ChannelSubscriber {
            callback: Function;
            once: boolean;
         }

         interface ChannelSubscription {
            subscribers: ChannelSubscriber[];
            listener: (_event: unknown, ...received: any[]) => void;
         }

         const channelSubscriptions: { [channel: string]: ChannelSubscription | undefined } = { __proto__: null } as any;

         function listenToChannel(
            channel: string,
            callback: Function,
            once: boolean,
            read?: (received: any[]) => any[] | undefined,
         ): () => void {
            let subscription = channelSubscriptions[channel];
            if (!subscription) {
               const subscribers: ChannelSubscriber[] = [];
               const listener = (_event: unknown, ...received: any[]) => {
                  const args = read ? read(received) : received;
                  if (!args) {
                     return;
                  }
                  for (const next of subscribers.slice()) {
                     if (subscribers.indexOf(next) < 0) {
                        continue;
                     }
                     if (next.once) {
                        unlistenToChannel(channel, next);
                     }
                     try {
                        next.callback(...args);
                     } catch (error) {
                        console.error(error);
                     }
                  }
               };
               subscription = { subscribers, listener };
               channelSubscriptions[channel] = subscription;
               ipcRenderer.on(channel, listener);
            }
            const subscriber: ChannelSubscriber = { callback, once };
            subscription.subscribers.push(subscriber);
            return () => unlistenToChannel(channel, subscriber);
         }

         function unlistenToChannel(channel: string, subscriber: ChannelSubscriber): void {
            const subscription = channelSubscriptions[channel];
            const at = subscription ? subscription.subscribers.indexOf(subscriber) : -1;
            if (!subscription || at < 0) {
               return;
            }
            subscription.subscribers.splice(at, 1);
            if (subscription.subscribers.length === 0) {
               delete channelSubscriptions[channel];
               ipcRenderer.removeListener(channel, subscription.listener);
            }
         }

         export const api = {
            vitestChannel: {
               on: (callback: Function) => {
                  return listenToChannel('vitestChannel', callback, false);
               },
               once: (callback: Function) => {
                  return listenToChannel('vitestChannel', callback, true);
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
         expect(output).toContain("return listenToChannel('app:pushIt', callback, false);");
         expect(output).toContain("return listenToChannel('app:pushIt', callback, true);");
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
});
