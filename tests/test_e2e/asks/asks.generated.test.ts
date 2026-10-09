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

import { cleanupAsks } from "@testutils/e2e/ask-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupAsks);

describe("ask, generated files", () => {
   it("declares only the handle method of an ask in window.d.ts", async () => {
      const project = await fixtures.run("ask-channels");
      const types = project.generated["window.d.ts"];

      expect(types).toContain(
         "hasUnsavedChanges: {\n      handle: (callback: (documentId: number) => boolean) => () => void;\n   };",
      );
      expect(types).toContain(
         "getEditorState: {\n      handle: (callback: () => Promise<EditorState>) => () => void;\n   };",
      );
      expect(types).toContain(
         "confirmClose: {\n      handle: (callback: (reason: string, ...flags: boolean[]) => void) => () => void;\n   };",
      );
      expect(types).toContain(
         "genericAsk: {\n      handle: (callback: <T>(value: T) => T) => () => void;\n   };",
      );
      // The answer of an ask does not travel as an error of an invoke.
      expect(types).not.toMatch(/hasUnsavedChanges: \{[^}]*@throws/);
   });

   it("types the answer as a promise of the awaited return type of the signature", async () => {
      const project = await fixtures.run("ask-channels");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, documentId: number): Promise<Awaited<boolean>> =>",
      );
      // A signature which already returns a promise is not wrapped again.
      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain): Promise<EditorState> =>",
      );
      expect(main).toContain(
         "<T>(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, value: T): Promise<Awaited<T>> =>",
      );
   });

   it("uses the wire names with the prefix, and a reply channel that no other channel can have", async () => {
      const project = await fixtures.run("ask-channels");
      const { "main.ts": main, "preload.ts": preload } = project.generated;

      expect(main).toContain(
         "askRenderer('hasUnsavedChanges', 'autoipc:hasUnsavedChanges', 'autoipc:hasUnsavedChanges:reply', target",
      );
      expect(preload).toContain("ipcRenderer.on('autoipc:hasUnsavedChanges',");
      expect(preload).toContain("'autoipc:hasUnsavedChanges:reply'");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("ask-channels");
      expect(await project.typecheck()).toBe("");
   });

   it("generates files that type-check when the schema has only asks", async () => {
      const project = await fixtures.run("ask-only");
      expect(await project.typecheck()).toBe("");
      const main = project.generated["main.ts"];
      expect(main).toContain(
         'import { ipcMain as electronIpcMain, webContents as electronWebContents } from "electron";',
      );
      // Nothing of the senders of the renderer, or of the envelope of the invoke channels.
      expect(main).not.toContain("isSenderAllowed");
      expect(main).not.toContain("settleInvoke");
      expect(main).not.toContain("registeredHandlers");
      expect(main).not.toContain("broadcastMessage");
   });
});
