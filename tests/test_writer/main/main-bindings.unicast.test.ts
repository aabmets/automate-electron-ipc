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

import { dedent } from "@testutils/text-utils.js";
import { renderSpecs } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestMainBindingsWriter } from "@testutils/writer/test-writers.js";
import { vitestChannelSpecs } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   it("should write empty ipc object when pfsArray is empty", async () => {
      const buffer = await renderSpecs(VitestMainBindingsWriter, []);
      const expectedOutput = "export const ipc = {};";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into ipc object", async () => {
      const pfsArray = vitestChannelSpecs.Unicast_RendererToMain;
      const buffer = await renderSpecs(VitestMainBindingsWriter, pfsArray);
      const expectedOutput = dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainInvokeEvent, IpcMain, WebContents } from "electron";

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
            validateSender?: (event: IpcMainInvokeEvent, channel: string) => boolean;
            onRejected?: (event: IpcMainInvokeEvent, channel: string) => void;
         }

         let ipcConfig: IpcConfig = {};

         export function configureIpc(config: IpcConfig): void {
            ipcConfig = { validateSender: config.validateSender, onRejected: config.onRejected };
         }

         function isSenderAllowed(event: IpcMainInvokeEvent, channel: string, allowedOrigins?: string[]): boolean {
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

         interface IpcErrorInfo {
            name: string;
            message: string;
            code?: string | number;
            data?: unknown;
         }

         type IpcEnvelope = { ok: true; value: unknown } | { ok: false; error: IpcErrorInfo };

         function toIpcError(error: unknown): IpcErrorInfo {
            try {
               const source = typeof error === 'object' && error !== null ? (error as { [key: string]: unknown }) : null;
               const name = source && typeof source.name === 'string' && source.name ? source.name : 'Error';
               const message = source && typeof source.message === 'string' ? source.message : String(error);
               const info: IpcErrorInfo = { name, message };
               if (source && (typeof source.code === 'string' || typeof source.code === 'number')) {
                  info.code = source.code;
               }
               if (source && source.data !== undefined) {
                  try {
                     info.data = structuredClone(source.data);
                  } catch {
                     // Data that cannot be cloned is left out.
                  }
               }
               return info;
            } catch {
               return { name: 'Error', message: 'The handler failed with an unreadable error' };
            }
         }

         async function settleInvoke(run: () => unknown): Promise<IpcEnvelope> {
            try {
               return { ok: true, value: await run() };
            } catch (error) {
               return { ok: false, error: toIpcError(error) };
            }
         }

         export const ipc = {
            vitestChannel: {
               handle: (callback: (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>, options?: IpcListenOptions) => {
                  const guard = (event: IpcMainInvokeEvent) => {
                     if (!isSenderAllowed(event, 'vitestChannel')) {
                        throw new IpcForbiddenError('vitestChannel');
                     }
                  };
                  const target = resolveIpcTarget(options);
                  const remove = () => {
                     unwatch();
                     if (target.handlers['vitestChannel'] === listener) {
                        delete target.handlers['vitestChannel'];
                        target.ipc.removeHandler('vitestChannel');
                     }
                  };
                  const handler = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     return callback(event, arg1, arg2);
                  };
                  const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>
                     settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));
                  target.ipc.removeHandler('vitestChannel');
                  target.ipc.handle('vitestChannel', listener);
                  target.handlers['vitestChannel'] = listener;
                  const unwatch = target.watch(remove, 'vitestChannel');
                  return remove;
               },
               handleOnce: (callback: (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>, options?: IpcListenOptions) => {
                  const guard = (event: IpcMainInvokeEvent) => {
                     if (!isSenderAllowed(event, 'vitestChannel')) {
                        throw new IpcForbiddenError('vitestChannel');
                     }
                  };
                  const target = resolveIpcTarget(options);
                  const remove = () => {
                     unwatch();
                     if (target.handlers['vitestChannel'] === listener) {
                        delete target.handlers['vitestChannel'];
                        target.ipc.removeHandler('vitestChannel');
                     }
                  };
                  const handler = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     remove();
                     return callback(event, arg1, arg2);
                  };
                  const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>
                     settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));
                  target.ipc.removeHandler('vitestChannel');
                  target.ipc.handle('vitestChannel', listener);
                  target.handlers['vitestChannel'] = listener;
                  const unwatch = target.watch(remove, 'vitestChannel');
                  return remove;
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
