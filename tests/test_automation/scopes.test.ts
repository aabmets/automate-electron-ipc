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
import { ipcAutomation } from "@src/automation.js";
import logger from "@src/logger.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import type * as t from "@types";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   const automation = withAutomationDir();

   describe("the files of the scopes", () => {
      const SCHEMA = [
         'import { defineChannels, invoke, send } from "automate-electron-ipc";',
         "export default defineChannels({",
         "   getVersion: invoke<() => Promise<string>>(),",
         '   getSettings: invoke<() => Promise<string>>({ scopes: ["settings"] }),',
         '   note: send<(text: string) => void>({ scopes: ["settings", "plugin-host"] }),',
         "});",
      ].join("\n");
      const generate = async (schema: string, overrides: Partial<t.IPCResolvedConfig> = {}) => {
         const schemaPath = path.join(automation.dir, "schema.ts");
         await fsp.writeFile(schemaPath, schema);
         automation.mockConfig({
            projectRoot: automation.dir,
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
            ...overrides,
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         await ipcAutomation();
      };
      const written = async () => (await fsp.readdir(path.join(automation.dir, "out"))).sort();

      it("writes a preload script and a declaration file for each scope, next to the usual ones", async () => {
         await generate(SCHEMA);

         expect(await written()).toStrictEqual([
            "main.ts",
            "preload.plugin-host.ts",
            "preload.settings.ts",
            "preload.ts",
            "window.d.ts",
            "window.plugin-host.d.ts",
            "window.settings.d.ts",
         ]);
      });

      it("gives each file the channels of its surface", async () => {
         await generate(SCHEMA);
         const read = (name: string) =>
            fsp.readFile(path.join(automation.dir, "out", name), "utf8");
         const channelsOf = (text: string) =>
            [...text.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);

         expect(channelsOf(await read("preload.ts"))).toStrictEqual(["getVersion"]);
         expect(channelsOf(await read("preload.settings.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("preload.plugin-host.ts"))).toStrictEqual([
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("window.settings.d.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("main.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
      });

      it("writes only the usual files for a schema without scopes", async () => {
         await generate(
            SCHEMA.replaceAll(/, \{ scopes: \[[^\]]*\] \}|\{ scopes: \[[^\]]*\] \}/g, "{}"),
         );

         expect(await written()).toStrictEqual(["main.ts", "preload.ts", "window.d.ts"]);
      });

      it("writes the empty files of the surface of no scope when every channel has scopes", async () => {
         await generate(
            [
               'import { defineChannels, invoke } from "automate-electron-ipc";',
               'export default defineChannels({ a: invoke<() => void>({ scopes: ["one"] }) });',
            ].join("\n"),
         );
         const read = (name: string) =>
            fsp.readFile(path.join(automation.dir, "out", name), "utf8");

         expect(await read("preload.ts")).toContain("export const api = {};");
         expect(await read("window.d.ts")).toContain("interface IpcApi {}");
         expect(await read("preload.one.ts")).toContain("   a: {");
      });

      it("rejects a utility path which is the file of a scope, and writes nothing", async () => {
         await expect(
            generate(SCHEMA, {
               utilityBindingsFilePath: path.join(automation.dir, "out/preload.settings.ts"),
            }),
         ).rejects.toThrowError(
            /'utilityBindingsPath' \(.*preload\.settings\.ts'\) is the file that the scope 'settings' is generated to/,
         );
         expect(await fsp.readdir(automation.dir)).toStrictEqual(["schema.ts"]);
      });

      it("rejects a utility path which is the declaration file of a scope", async () => {
         await expect(
            generate(SCHEMA, {
               utilityBindingsFilePath: path.join(automation.dir, "out/window.plugin-host.d.ts"),
            }),
         ).rejects.toThrowError(/is the file that the scope 'plugin-host' is generated to/);
      });

      it("rejects an invalid scope name with the channel and the file", async () => {
         await expect(
            generate(
               [
                  'import { defineChannels, invoke } from "automate-electron-ipc";',
                  'export default defineChannels({ a: invoke<() => void>({ scopes: ["Not Valid"] }) });',
               ].join("\n"),
            ),
         ).rejects.toThrowError(/is not a scope name/);
      });
   });
});
