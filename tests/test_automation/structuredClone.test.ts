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
import logger from "@src/logger.js";
import { mockAutomationConfig } from "@testutils/automation-utils.js";
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

   const mockConfig = (overrides: Partial<t.IPCResolvedConfig>) =>
      mockAutomationConfig(dir, overrides);

   describe("structured clone", () => {
      const schema = (signature: string) =>
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export class User {}",
            "export default defineChannels({",
            `   save: invoke<${signature}>(),`,
            "});",
            "",
         ].join("\n");

      const run = async (contents: string) => {
         const schemaPath = path.join(dir, "ipc/schema.ts");
         await fsp.mkdir(path.dirname(schemaPath), { recursive: true });
         await fsp.writeFile(schemaPath, contents);
         mockConfig({
            ipcDataDir: "ipc",
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         return ipcAutomation();
      };

      it("warns about a class instance, and still generates the bindings", async () => {
         const warn = vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await run(schema("(user: User) => Promise<void>"));

         expect(warn).toHaveBeenCalledTimes(1);
         expect(warn.mock.calls[0][0]).toStrictEqual([
            expect.stringContaining(
               "Schema file 'ipc/schema.ts': Channel 'save': parameter 'user'",
            ),
         ]);
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain("save");
      });

      it("rejects a function parameter and writes nothing", async () => {
         // Regression for T19: Electron threw 'An object could not be cloned' when it was called.
         vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await expect(run(schema("(cb: () => void) => Promise<void>"))).rejects.toThrowError(
            /Channel 'save': parameter 'cb' contains a function \('\(\) => void'\)/,
         );

         await expect(fsp.stat(path.join(dir, "out/main.ts"))).rejects.toMatchObject({
            code: "ENOENT",
         });
      });

      it("warns about nothing for plain data", async () => {
         const warn = vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await run(schema("(id: number, tags: string[]) => Promise<{ name: string }>"));

         expect(warn.mock.calls[0][0]).toStrictEqual([]);
      });
   });
});
