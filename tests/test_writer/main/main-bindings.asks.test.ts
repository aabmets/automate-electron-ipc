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

import { renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestMainBindingsWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   describe("ask channels", () => {
      const ask = {
         name: "askIt",
         kind: "Unicast",
         direction: "MainToRenderer",
         params: ["id: number"],
         returnType: "boolean",
      } as const;
      const askAsync = {
         name: "askLater",
         kind: "Unicast",
         direction: "MainToRenderer",
         returnType: "Promise<string>",
      } as const;
      const emit = { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" } as const;
      const render = (
         channels: Parameters<typeof buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => renderWith(VitestMainBindingsWriter, channels, config);

      it("generates invoke and invokeWith, which share one helper", async () => {
         const output = await render([ask, askAsync]);

         expect(output).toContain(
            "invoke: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, id: number): Promise<Awaited<boolean>> =>",
         );
         expect(output).toContain(
            "askRenderer('askIt', 'askIt', 'askIt:reply', target, [id]) as Promise<Awaited<boolean>>,",
         );
         expect(output).toContain(
            "invokeWith: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, options: IpcAskOptions, id: number): Promise<Awaited<boolean>> =>",
         );
         expect(output).toContain(
            "askRenderer('askIt', 'askIt', 'askIt:reply', target, [id], options) as Promise<Awaited<boolean>>,",
         );
         expect(output).toContain("export class IpcAskError extends Error {");
         expect(output).toContain("export interface IpcAskOptions {");
         expect(output.match(/^function askRenderer\(/gm)).toHaveLength(1);
      });

      it("watches the commit of a navigation and the crash state to settle a question", async () => {
         const output = await render([ask]);

         expect(output).toContain("contents.isDestroyed() || contents.isCrashed()");
         expect(output).toContain("watchEvent(asked, 'destroyed', onGone),");
         expect(output).toContain("watchEvent(asked, 'render-process-gone', onGone),");
         expect(output).toContain(
            "frame ? watchEvent(asked, 'did-frame-navigate', onFrameNavigate) : watchEvent(asked, 'did-navigate', onGone),",
         );
         // A question adds no listener of its own to the contents (T87).
         expect(output).not.toMatch(/contents\??\.(on|once|removeListener)\(/);
         expect(output).not.toContain("did-start-navigation");
         expect(output).not.toContain("will-navigate");
      });

      it("does not wrap the promise of an async signature again", async () => {
         const output = await render([askAsync]);

         expect(output).toContain(
            "invoke: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain): Promise<string> =>",
         );
         expect(output).toContain("target, []) as Promise<string>,");
      });

      it("imports ipcMain and the types of the reply listener, and no sender validation", async () => {
         const output = await render([ask]);

         expect(output).toContain(
            'import { ipcMain as electronIpcMain, webContents as electronWebContents } from "electron";',
         );
         expect(output).toContain(
            'import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain, IpcMainEvent } from "electron";',
         );
         expect(output).not.toContain("isSenderAllowed");
         expect(output).not.toContain("IpcForbiddenError");
         expect(output).not.toContain("registeredHandlers");
         expect(output).not.toContain("settleInvoke");
      });

      it("declares broadcastMessage and sendToSenderFrame for an emit only", async () => {
         const asks = await render([ask]);
         const emits = await render([emit]);
         const both = await render([ask, emit]);

         expect(asks).toContain("function resolveSendTarget(");
         expect(asks).not.toContain("function broadcastMessage(");
         expect(asks).not.toContain("function sendToSenderFrame(");
         expect(emits).not.toContain("askRenderer");
         expect(emits).not.toContain("IpcAskError");
         expect(emits).toContain("function broadcastMessage(");
         expect(emits).toContain("function sendToSenderFrame(");
         expect(both).toContain("function broadcastMessage(");
         expect(both).toContain("function askRenderer(");
         expect(both.match(/^function resolveSendTarget\(/gm)).toHaveLength(1);
      });

      it("keeps the envelope and the reply listener of the other channels", async () => {
         const output = await render([ask, getIt]);

         expect(output).toContain("function settleInvoke(");
         expect(output).toContain("function isSenderAllowed(");
         expect(output).toContain("function listenForAskReplies(");
         expect(output.match(/import \{ ipcMain as electronIpcMain/g)).toHaveLength(1);
      });

      it("is not changed by rawErrors, since the reply is always an envelope", async () => {
         expect(await render([ask], { rawErrors: true })).toBe(await render([ask]));
      });

      it("puts the prefix in front of the request and the reply channel only", async () => {
         const output = await render([ask], { channelPrefix: "app:" });

         expect(output).toContain(
            "askRenderer('askIt', 'app:askIt', 'app:askIt:reply', target, [id])",
         );
         expect(output).not.toContain("'app:askIt:reply:");
         const bare = await render([ask], { channelPrefix: "" });
         expect(bare).toContain("askRenderer('askIt', 'askIt', 'askIt:reply', target, [id])");
         expect(await render([ask], {})).toBe(bare);
      });
   });
});
