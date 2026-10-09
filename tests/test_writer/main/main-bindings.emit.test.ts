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
import { buildFileSpecs, vitestChannelSpecs } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   it("should write Broadcast MainToRenderer callables into ipc object", async () => {
      const pfsArray = vitestChannelSpecs.Broadcast_MainToRenderer;
      const buffer = await renderSpecs(VitestMainBindingsWriter, pfsArray);
      const expectedOutput = dedent(`
         import { webContents as electronWebContents } from "electron";
         import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain } from "electron";

         function resolveSendTarget(
            target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,
         ): WebContents | WebFrameMain {
            return 'webContents' in target ? target.webContents : target;
         }

         function broadcastMessage(
            channel: string,
            args: unknown[],
            filter?: (contents: WebContents) => boolean,
         ): void {
            for (const contents of electronWebContents.getAllWebContents()) {
               if (!contents.isDestroyed() && (!filter || filter(contents))) {
                  contents.send(channel, ...args);
               }
            }
         }

         function sendToSenderFrame(
            event: { readonly senderFrame: WebFrameMain | null },
            channel: string,
            args: unknown[],
         ): boolean {
            let frame: WebFrameMain | null = null;
            try {
               frame = event.senderFrame;
               if (frame && (frame.isDestroyed?.() || frame.detached)) {
                  frame = null;
               }
            } catch {
               frame = null;
            }
            if (!frame) {
               return false;
            }
            frame.send(channel, ...args);
            return true;
         }

         export const ipc = {
            vitestChannel: {
               send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, arg1: number, ...arg2: number[]) =>
                  resolveSendTarget(target).send('vitestChannel', arg1, ...arg2),
               sendToSender: (event: { readonly senderFrame: WebFrameMain | null }, arg1: number, ...arg2: number[]) =>
                  sendToSenderFrame(event, 'vitestChannel', [arg1, ...arg2]),
               broadcast: (arg1: number, ...arg2: number[]) =>
                  broadcastMessage('vitestChannel', [arg1, ...arg2]),
               broadcastTo: (filter: (contents: WebContents) => boolean, arg1: number, ...arg2: number[]) =>
                  broadcastMessage('vitestChannel', [arg1, ...arg2], filter),
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write an immediate sender and a separate binder for triggered channels", async () => {
      // Regression for B5: the sender used to register a window listener on every call.
      const pfsArray = buildFileSpecs({
         name: "focused",
         kind: "Broadcast",
         direction: "MainToRenderer",
         params: ["state: boolean", "...tags: string[]"],
         trigger: "focus",
      });
      const buffer = await renderSpecs(VitestMainBindingsWriter, pfsArray);
      const expectedOutput = dedent(`
         import { webContents as electronWebContents } from "electron";
         import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain } from "electron";

         function resolveSendTarget(
            target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,
         ): WebContents | WebFrameMain {
            return 'webContents' in target ? target.webContents : target;
         }

         function broadcastMessage(
            channel: string,
            args: unknown[],
            filter?: (contents: WebContents) => boolean,
         ): void {
            for (const contents of electronWebContents.getAllWebContents()) {
               if (!contents.isDestroyed() && (!filter || filter(contents))) {
                  contents.send(channel, ...args);
               }
            }
         }

         function sendToSenderFrame(
            event: { readonly senderFrame: WebFrameMain | null },
            channel: string,
            args: unknown[],
         ): boolean {
            let frame: WebFrameMain | null = null;
            try {
               frame = event.senderFrame;
               if (frame && (frame.isDestroyed?.() || frame.detached)) {
                  frame = null;
               }
            } catch {
               frame = null;
            }
            if (!frame) {
               return false;
            }
            frame.send(channel, ...args);
            return true;
         }

         export const ipc = {
            focused: {
               send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, state: boolean, ...tags: string[]) =>
                  resolveSendTarget(target).send('focused', state, ...tags),
               sendToSender: (event: { readonly senderFrame: WebFrameMain | null }, state: boolean, ...tags: string[]) =>
                  sendToSenderFrame(event, 'focused', [state, ...tags]),
               broadcast: (state: boolean, ...tags: string[]) =>
                  broadcastMessage('focused', [state, ...tags]),
               broadcastTo: (filter: (contents: WebContents) => boolean, state: boolean, ...tags: string[]) =>
                  broadcastMessage('focused', [state, ...tags], filter),
               bind: (browserWindow: BrowserWindow, provider: () => [state: boolean, ...tags: string[]] | Promise<[state: boolean, ...tags: string[]]>, onError?: (error: unknown) => void) => {
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
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });
});
