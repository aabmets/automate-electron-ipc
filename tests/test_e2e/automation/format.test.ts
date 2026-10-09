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
import { ipcAutomation, planRun } from "@src/automation.js";
import { findStaleOutputs } from "@src/check.js";
import { notice } from "@src/output-files.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixturesDir = path.resolve(import.meta.dirname, "../../fixtures");
const repoModules = path.resolve(import.meta.dirname, "../../../node_modules");

describe("the format option", () => {
   let dir = "";

   /** Copies the fixture, sets `format`, and gives the project the Biome of this repo. */
   const setup = async (format: string | false, linkModules = true) => {
      await fsp.cp(path.join(fixturesDir, "single-file"), dir, { recursive: true });
      const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
      manifest.config.autoipc.format = format;
      await fsp.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest));
      // The formatter config of the project: Biome must apply it, not its own defaults.
      await fsp.writeFile(
         path.join(dir, "biome.json"),
         JSON.stringify({
            formatter: { indentStyle: "space", indentWidth: 2, lineWidth: 60 },
            javascript: { formatter: { quoteStyle: "single" } },
         }),
      );
      if (linkModules) {
         await fsp.symlink(repoModules, path.join(dir, "node_modules"), "dir");
      }
   };
   const read = (name: string) => fsp.readFile(path.join(dir, "ipc", name), "utf8");

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-format-"));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   it("writes the files as the formatter of the project formats them", async () => {
      await setup("biome");
      await ipcAutomation(dir);

      const main = await read("main.ts");
      expect(main).toContain("\n  readonly code");
      expect(main).not.toContain("\n   readonly code");
      expect(main).toContain("from './schema'");
      expect(main).not.toContain('from "./schema"');
   });

   it("keeps the notice as the first lines of every file", async () => {
      await setup("biome");
      const plan = await planRun({ cwd: dir });

      expect(plan?.outputs.length).toBeGreaterThan(0);
      for (const output of plan?.outputs ?? []) {
         expect(output.contents.startsWith(`${notice(plan?.config as never)}\n\n`)).toBe(true);
      }
   });

   it("leaves the files as they are rendered when format is false", async () => {
      await setup(false);
      await ipcAutomation(dir);

      expect(await read("main.ts")).toContain("\n   readonly code");
   });

   it("lets --check call a fresh project up to date after a formatted run", async () => {
      await setup("biome");
      await ipcAutomation(dir);

      expect(await findStaleOutputs({ cwd: dir })).toEqual([]);
   });

   it("lets --check list the files that a run without the formatter wrote", async () => {
      await setup("biome");
      await ipcAutomation({ cwd: dir, overrides: { format: false } });

      const stale = await findStaleOutputs({ cwd: dir });
      expect(stale?.map((file) => path.posix.basename(file))).toEqual([
         "main.ts",
         "preload.ts",
         "window.d.ts",
      ]);
   });

   it("writes the files unformatted, with one warning, when the binary is missing", async () => {
      await setup("prettier", false);
      const warn = vi.spyOn(console, "warn");
      await ipcAutomation(dir);

      expect(await read("main.ts")).toContain("\n   readonly code");
      const missing = warn.mock.calls.filter(([text]) => String(text).includes("does not exist"));
      expect(missing).toHaveLength(1);
      expect(String(missing[0][0])).toContain("node_modules/.bin/prettier");
   });

   it("fails with the output of the formatter when it rejects a file", async () => {
      await setup("biome");
      await fsp.writeFile(path.join(dir, "biome.json"), "{ not json");

      await expect(ipcAutomation(dir)).rejects.toThrowError(
         /The formatter 'biome' failed on 'ipc\/main.ts'/,
      );
   });
});
