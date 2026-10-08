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
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import cfg from "@src/config.js";
import logger from "@src/logger.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   let dir: string;

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-automation-"));
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   const mockConfig = (overrides: Partial<t.IPCResolvedConfig>) => {
      vi.spyOn(cfg, "getResolvedConfig").mockResolvedValue({
         codeIndent: 3,
         projectUsesNodeNext: false,
         mainBindingsFilePath: path.join(dir, "out/main.ts"),
         preloadBindingsFilePath: path.join(dir, "out/preload.ts"),
         rendererTypesFilePath: path.join(dir, "out/window.d.ts"),
         ...overrides,
      } as t.IPCResolvedConfig);
   };

   it("creates the schema directory and skips when the schema path does not exist", async () => {
      const schemaPath = path.join(dir, "ipc/schema.ts");
      mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      const warn = vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect((await fsp.stat(path.dirname(schemaPath))).isDirectory()).toBe(true);
      await expect(fsp.stat(path.join(dir, "out/main.ts"))).rejects.toThrowError();
   });

   it("writes empty bindings and warns when the schema has no channels", async () => {
      const schemaPath = path.join(dir, "schema.ts");
      await fsp.writeFile(schemaPath, "export const x = 1;\n");
      mockConfig({
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const warn = vi.spyOn(logger, "noChannelExpressions").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain(
         "ANY CHANGES TO THIS FILE WILL NOT PERSIST",
      );
   });

   it("skips schema directory files without channels", async () => {
      const schemaDir = path.join(dir, "schema");
      await fsp.mkdir(path.join(schemaDir, "nested"), { recursive: true });
      await fsp.writeFile(path.join(schemaDir, "helpers.ts"), "export const x = 1;\n");
      await fsp.writeFile(
         path.join(schemaDir, "nested/user.ts"),
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({",
            "   getUser: invoke<(id: number) => Promise<string>>(),",
            "});",
            "",
         ].join("\n"),
      );
      mockConfig({ ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) } } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      const reported = success.mock.calls[0][0];
      expect(reported.map((pfs) => pfs.relativePath)).toStrictEqual([
         path.join("nested", "user.ts"),
      ]);
      expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain("getUser");
   });
});
