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
import path from "node:path";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

/** The paths of the API that each scope of the fixture `scoped-windows` gets. */
const SURFACES: Record<string, string[]> = {
   default: ["getVersion.invoke", "log.send"],
   settings: [
      "getSettings.invoke",
      "getVersion.invoke",
      "log.send",
      "notify.send",
      "saveSettings.invoke",
      "themeChanged.on",
      "themeChanged.once",
      "vault.invoke",
   ],
   editor: [
      "chat.onClose",
      "chat.onConnection",
      "chat.onOverflow",
      "chat.onReady",
      "chat.on",
      "chat.send",
      "exportRows.stream",
      "getVersion.invoke",
      "hasUnsavedChanges.handle",
      "log.send",
      "notify.send",
      "openFile.invoke",
   ].sort(),
};

const FILES: Record<string, { preload: string; types: string }> = {
   default: { preload: "preload.ts", types: "window.d.ts" },
   settings: { preload: "preload.settings.ts", types: "window.settings.d.ts" },
   editor: { preload: "preload.editor.ts", types: "window.editor.d.ts" },
};

describe("fixture scoped-windows, the files of the scopes", () => {
   it("writes a preload script and a .d.ts file for each scope, next to the default ones", async () => {
      const project = await fixtures.run("scoped-windows");
      const names = await fsp.readdir(path.join(project.dir, project.ipcDataDir));

      expect(names.filter((name) => /^(preload|window)/.test(name)).sort()).toStrictEqual([
         "preload.editor.ts",
         "preload.settings.ts",
         "preload.ts",
         "window.d.ts",
         "window.editor.d.ts",
         "window.settings.d.ts",
      ]);
   });

   it.each(Object.keys(SURFACES))(
      "exposes only the channels of the scope '%s', and declares the same ones",
      async (scope) => {
         const project = await fixtures.run("scoped-windows");
         const fake = createFakePreloadElectron();
         loadGenerated(await project.read(FILES[scope].preload), { electron: fake.electron });

         const exposed = callablePaths(fake.exposed.ipc);
         expect(exposed).toStrictEqual([...SURFACES[scope]].sort());
         expect(windowIpcPaths(await project.read(FILES[scope].types))).toStrictEqual(exposed);
      },
   );

   it("generates the preload script of a scope like any other, with the channels of the scope only", async () => {
      const project = await fixtures.run("scoped-windows");
      const settings = await project.read("preload.settings.ts");

      expect(settings).toContain("export function expose(key = 'ipc'): void {");
      expect(settings).toContain("ipcRenderer.invoke('autoipc:getSettings', ...args)");
      expect(settings).not.toContain("openFile");
   });

   it.each(Object.keys(SURFACES))(
      "generates files that type-check for the scope '%s'",
      async (scope) => {
         const project = await fixtures.run("scoped-windows");

         expect(await project.typecheckScope(scope)).toBe("");
      },
   );

   it("imports only the types that the channels of a scope use", async () => {
      const project = await fixtures.run("scoped-windows");

      expect(await project.read("window.settings.d.ts")).toContain(
         'import type { Settings } from "./schema";',
      );
      expect(await project.read("window.settings.d.ts")).not.toContain("Document");
      expect(await project.read("window.editor.d.ts")).toContain(
         'import type { Document } from "./schema";',
      );
      expect(await project.read("window.editor.d.ts")).not.toContain("Settings");
      expect(project.generated["window.d.ts"]).not.toContain("import");
   });

   it("gives the main bindings every channel, in the one file", async () => {
      const project = await fixtures.run("scoped-windows");
      const { ipc } = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
      });

      expect(Object.keys(ipc).sort()).toStrictEqual([
         "chat",
         "exportRows",
         "getSettings",
         "getVersion",
         "hasUnsavedChanges",
         "log",
         "notify",
         "openFile",
         "saveSettings",
         "themeChanged",
         "vault",
      ]);
   });
});
