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

   it("should write a connect method for Port channels, which pairs the windows once they have loaded", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";
         import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";

         interface WatchableEmitter {
            on(event: string, listener: (...args: any[]) => void): unknown;
            removeListener(event: string, listener: (...args: any[]) => void): unknown;
         }

         interface EventWatch {
            callbacks: ((...args: any[]) => void)[];
            listener: (...args: any[]) => void;
         }

         const eventWatches = new WeakMap<object, { [event: string]: EventWatch | undefined }>();

         function watchEvent(
            emitter: WatchableEmitter,
            event: string,
            callback: (...args: any[]) => void,
         ): () => void {
            const known = eventWatches.get(emitter);
            const watched: { [event: string]: EventWatch | undefined } = known ?? ({ __proto__: null } as any);
            if (!known) {
               eventWatches.set(emitter, watched);
            }
            let watch = watched[event];
            if (!watch) {
               const callbacks: ((...args: any[]) => void)[] = [];
               watch = {
                  callbacks,
                  listener: (...args: any[]) => {
                     for (const next of callbacks.slice()) {
                        if (callbacks.indexOf(next) >= 0) {
                           try {
                              next(...args);
                           } catch (error) {
                              console.error(error);
                           }
                        }
                     }
                  },
               };
               watched[event] = watch;
               emitter.on(event, watch.listener);
            }
            const { callbacks, listener } = watch;
            callbacks.push(callback);
            return () => {
               const at = callbacks.indexOf(callback);
               if (at < 0) {
                  return;
               }
               callbacks.splice(at, 1);
               if (callbacks.length === 0 && watched[event] === watch) {
                  delete watched[event];
                  try {
                     emitter.removeListener(event, listener);
                  } catch {
                     // Destroyed contents have dropped their listeners, and cannot be reached.
                  }
               }
            };
         }

         let lastPortConnectionId = 0;
         const portEnds = new Map<string, { contents: WebContents; close: () => void }>();
         const portDisconnectChannels = new Set<string>();

         function listenForPortDisconnects(channel: string): void {
            if (portDisconnectChannels.has(channel)) {
               return;
            }
            portDisconnectChannels.add(channel);
            electronIpcMain.on(\`\${channel}:disconnect\`, (event: IpcMainEvent, key: unknown) => {
               const end = typeof key === 'string' ? portEnds.get(key) : undefined;
               if (end && !end.contents.isDestroyed() && end.contents === event.sender) {
                  end.close();
               }
            });
         }

         interface PageLoadWatch {
            isLoaded: () => boolean;
            dispose: () => void;
         }

         function watchPageLoad(contents: WebContents, onLoad: () => void): PageLoadWatch {
            let loaded = !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== '';
            // Whether the load that is going on has been reported already.
            let settled = !contents.isDestroyed() && !contents.isLoading();
            let failed = false;
            // Whether a main-frame navigation has committed since the watch began.
            let committed = false;
            // A main-frame navigation that commits replaces the document. One that starts and stops
            // without a commit (a prevented one, a download, a 204 response) leaves the page as it was.
            const commit = () => {
               loaded = false;
               settled = false;
               failed = false;
               committed = true;
            };
            // A failed load ends in the error page of Electron, which fires its own did-finish-load.
            // ERR_ABORTED (-3) shows no error page, so the page that was loaded stays loaded. When it
            // follows a commit, the document that committed is the page, and it loaded as far as it got.
            const fail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {
               if (!isMainFrame) {
                  return;
               }
               if (code !== -3) {
                  failed = true;
                  loaded = false;
               } else if (!committed) {
                  failed = true;
               }
            };
            const finish = () => {
               if (failed) {
                  return;
               }
               loaded = true;
               settled = true;
               onLoad();
            };
            const stop = () => {
               if (!settled && !failed) {
                  finish();
               }
            };
            const stops = [
               watchEvent(contents, 'did-navigate', commit),
               watchEvent(contents, 'did-fail-load', fail),
               watchEvent(contents, 'did-finish-load', finish),
               watchEvent(contents, 'did-stop-loading', stop),
            ];
            return {
               isLoaded: () => loaded,
               dispose: () => {
                  for (const unwatch of stops) {
                     unwatch();
                  }
               },
            };
         }

         function connectPorts(channel: string, winA: BrowserWindow, winB: BrowserWindow): { close: () => void } {
            const id = ++lastPortConnectionId;
            // Both windows are resolved before anything is registered: the getter of a destroyed window throws.
            const ends = [
               { key: \`\${id}:a\`, win: winA, contents: winA.webContents },
               { key: \`\${id}:b\`, win: winB, contents: winB.webContents },
            ];
            const watched = winA === winB ? [ends[0]] : ends;
            let closed = false;
            const watches = new Map<BrowserWindow, PageLoadWatch>();
            const unwatchClosed: (() => void)[] = [];
            const isReady = (win: BrowserWindow) => !win.isDestroyed() && !!watches.get(win)?.isLoaded();
            const pair = () => {
               if (closed || !isReady(winA) || !isReady(winB)) {
                  return;
               }
               const { port1, port2 } = new MessageChannelMain();
               ends[0].contents.postMessage(channel, ends[0].key, [port1]);
               ends[1].contents.postMessage(channel, ends[1].key, [port2]);
            };
            const close = () => {
               if (closed) {
                  return;
               }
               closed = true;
               for (const end of watched) {
                  watches.get(end.win)?.dispose();
               }
               for (const unwatch of unwatchClosed.splice(0)) {
                  unwatch();
               }
               for (const end of ends) {
                  portEnds.delete(end.key);
                  if (!end.win.isDestroyed()) {
                     end.contents.send(\`\${channel}:close\`, end.key);
                  }
               }
            };
            // A failure from here on undoes what was registered, since the caller never gets the handle.
            try {
               for (const end of ends) {
                  portEnds.set(end.key, { contents: end.contents, close });
               }
               listenForPortDisconnects(channel);
               for (const end of watched) {
                  unwatchClosed.push(watchEvent(end.win, 'closed', close));
                  watches.set(end.win, watchPageLoad(end.contents, pair));
               }
               pair();
            } catch (error) {
               close();
               throw error;
            }
            return { close };
         }

         export const ipc = {
            vitestChannel: {
               connect: (winA: BrowserWindow, winB: BrowserWindow) => connectPorts('vitestChannel', winA, winB),
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
