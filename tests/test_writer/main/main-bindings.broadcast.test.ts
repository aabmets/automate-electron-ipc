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
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   it("should write Broadcast RendererToMain callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainEvent, IpcMain, WebContents } from "electron";

         export class IpcForbiddenError extends Error {
            readonly code = 'IPC_FORBIDDEN';
            readonly channel: string;
            constructor(channel: string) {
               super(\`The sender of the message is not allowed to use the channel '\${channel}'\`);
               this.name = 'IpcForbiddenError';
               this.channel = channel;
            }
         }

         export interface IpcConfig {
            validateSender?: (event: IpcMainEvent, channel: string) => boolean;
            onRejected?: (event: IpcMainEvent, channel: string) => void;
         }

         let ipcConfig: IpcConfig = {};

         export function configureIpc(config: IpcConfig): void {
            ipcConfig = { validateSender: config.validateSender, onRejected: config.onRejected };
         }

         function isSenderAllowed(event: IpcMainEvent, channel: string, allowedOrigins?: string[]): boolean {
            const validateSender = ipcConfig.validateSender;
            if (!allowedOrigins && !validateSender) {
               return true;
            }
            let allowed = false;
            try {
               const frame = event.senderFrame;
               const origin = frame ? frame.origin : null;
               allowed =
                  frame != null &&
                  (!allowedOrigins || (typeof origin === 'string' && allowedOrigins.includes(origin))) &&
                  (!validateSender || validateSender(event, channel) === true);
            } catch {
               allowed = false;
            }
            if (!allowed && ipcConfig.onRejected) {
               try {
                  ipcConfig.onRejected(event, channel);
               } catch {
                  // A failing hook must not decide whether the call is rejected.
               }
            }
            return allowed;
         }

         export interface IpcListenOptions {
            /**
             * Registers on the \`ipc\` of these contents instead of the global \`ipcMain\`: only the
             * messages of this page arrive, an \`invoke\` handler wins over the global one, and the
             * registration is removed when the contents are destroyed.
             */
            webContents?: WebContents;
         }

         interface IpcTarget {
            ipc: IpcMain;
            handlers: { [channel: string]: unknown };
            watch: (remove: () => void, handled?: string) => () => void;
         }

         interface IpcContentsRecord {
            handlers: { [channel: string]: unknown };
            removers: (() => void)[];
            /** The remover of the registration which holds the handler of each channel now. */
            current: { [channel: string]: unknown };
         }

         const registeredHandlers: { [channel: string]: unknown } = { __proto__: null };

         const contentsIpcRegistry: { [id: string]: unknown } = { __proto__: null };

         function resolveIpcTarget(options?: IpcListenOptions): IpcTarget {
            const contents = options?.webContents;
            if (!contents) {
               return { ipc: electronIpcMain, handlers: registeredHandlers, watch: () => () => {} };
            }
            if (contents.isDestroyed()) {
               throw new TypeError('Object has been destroyed');
            }
            const id = contents.id;
            let record = contentsIpcRegistry[id] as IpcContentsRecord | undefined;
            if (!record) {
               const created: IpcContentsRecord = { handlers: { __proto__: null }, removers: [], current: { __proto__: null } };
               record = created;
               contentsIpcRegistry[id] = created;
               contents.once('destroyed', () => {
                  delete contentsIpcRegistry[id];
                  for (const remove of created.removers.slice()) {
                     remove();
                  }
               });
            }
            const { handlers, removers, current } = record;
            const forget = (remove: () => void): void => {
               for (let at = 0; at < removers.length; at++) {
                  if (removers[at] === remove) {
                     removers.splice(at, 1);
                     return;
                  }
               }
            };
            return {
               ipc: contents.ipc,
               handlers,
               watch: (remove, handled) => {
                  // A handler replaces the one of its channel, so the registration it replaced is released:
                  // its remover would otherwise hold the replaced callback until the contents are destroyed.
                  if (handled !== undefined) {
                     const replaced = current[handled] as (() => void) | undefined;
                     if (replaced) {
                        forget(replaced);
                     }
                     current[handled] = remove;
                  }
                  removers.push(remove);
                  return () => {
                     forget(remove);
                     if (handled !== undefined && current[handled] === remove) {
                        delete current[handled];
                     }
                  };
               },
            };
         }

         export const ipc = {
            vitestChannel: {
               on: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void, options?: IpcListenOptions) => {
                  const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'vitestChannel');
                  const target = resolveIpcTarget(options);
                  const remove = () => {
                     unwatch();
                     target.ipc.off('vitestChannel', listener);
                  };
                  const listener = (event: IpcMainEvent, arg1: string, arg2: string) => {
                     if (!guard(event)) {
                        return;
                     }
                     return callback(event, arg1, arg2);
                  };
                  target.ipc.on('vitestChannel', listener);
                  const unwatch = target.watch(remove);
                  return remove;
               },
               once: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void, options?: IpcListenOptions) => {
                  const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'vitestChannel');
                  const target = resolveIpcTarget(options);
                  const remove = () => {
                     unwatch();
                     target.ipc.off('vitestChannel', listener);
                  };
                  const listener = (event: IpcMainEvent, arg1: string, arg2: string) => {
                     if (!guard(event)) {
                        return;
                     }
                     remove();
                     return callback(event, arg1, arg2);
                  };
                  target.ipc.on('vitestChannel', listener);
                  const unwatch = target.watch(remove);
                  return remove;
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
