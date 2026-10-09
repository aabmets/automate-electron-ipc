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

import { cleanupAsks, createContents, currentProject, loadMain } from "@testutils/e2e/ask-utils.js";
import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupAsks);

/** A plain object, which contextBridge copies with its fields, unlike an `Error`. */
const plainError = () => ({
   name: "NotFoundError",
   message: "gone",
   code: "NOT_FOUND",
   data: { id: 7 },
});

describe("ask, from the main process to a responder and back", () => {
   /** Joins the generated main process and preload script with fakes of the wire between them. */
   async function connect() {
      const main = await loadMain();
      const preload = createFakePreloadElectron();
      loadGenerated(currentProject()?.generated["preload.ts"] ?? "", {
         electron: preload.electron,
      });
      const { ipcRenderer } = preload.electron;
      const contents = createContents(1);
      contents.send.mockImplementation((channel: string, ...args: unknown[]) => {
         const call = ipcRenderer.on.mock.calls.find(([name]) => name === channel);
         // Electron delivers it later, and without the main process waiting.
         queueMicrotask(() => call?.[1]({ sender: "main" }, ...args));
      });
      ipcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
         const name = channel.replace(/^autoipc:/, "").replace(/:reply$/, "");
         main.reply(name, contents, args[0], args[1]);
      });
      return { ...main, contents, rendererIpc: preload.exposed.ipc };
   }

   it("resolves with what the responder in the renderer returns", async () => {
      const { ipc, contents, rendererIpc } = await connect();
      rendererIpc.hasUnsavedChanges.handle((documentId: number) => documentId === 7);
      rendererIpc.getEditorState.handle(async () => ({ documentId: 3, text: "text" }));

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).resolves.toBe(true);
      await expect(ipc.hasUnsavedChanges.invoke(contents, 8)).resolves.toBe(false);
      await expect(ipc.getEditorState.invoke(contents)).resolves.toStrictEqual({
         documentId: 3,
         text: "text",
      });
   });

   it("rejects with the error that the responder throws", async () => {
      const { ipc, IpcAskError, contents, rendererIpc } = await connect();
      rendererIpc.hasUnsavedChanges.handle(() => {
         throw plainError();
      });

      const error = await ipc.hasUnsavedChanges
         .invoke(contents, 7)
         .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(IpcAskError);
      expect(error).toMatchObject({
         name: "NotFoundError",
         message: "gone",
         code: "NOT_FOUND",
         data: { id: 7 },
      });
   });

   it("rejects when no responder is registered, and after it is disposed", async () => {
      const { ipc, contents, rendererIpc } = await connect();

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject({
         code: "IPC_ASK_NO_HANDLER",
      });
      const dispose = rendererIpc.hasUnsavedChanges.handle(() => true);
      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).resolves.toBe(true);
      dispose();
      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject({
         code: "IPC_ASK_NO_HANDLER",
      });
   });
});
