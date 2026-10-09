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

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { loadSchemaSources } from "@src/schema-sources.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import type * as t from "@types";
import { describe, expect, it, vi } from "vitest";

const automation = withAutomationDir("schema-sources-");

/** A config whose schema path is `schemaPath`, with the stats that the config resolution reads. */
function configFor(schemaPath: string, ipcDataDir = "src\\ipc"): t.IPCResolvedConfig {
   const stats = fs.statSync(schemaPath, { throwIfNoEntry: false }) ?? null;
   return { ipcDataDir, ipcSchema: { path: schemaPath, stats } } as unknown as t.IPCResolvedConfig;
}

describe("loadSchemaSources", () => {
   it("reads the schema file and names it with 'schema.ts' in the data directory", async () => {
      const file = path.join(automation.dir, "schema.ts");
      fs.writeFileSync(file, "export const a = 1;");
      expect(await loadSchemaSources(configFor(file))).toStrictEqual([
         { fullPath: file, relativePath: "src/ipc/schema.ts", contents: "export const a = 1;" },
      ]);
   });

   it("reads the source files of a schema directory in the order of their relative paths", async () => {
      const schemaDir = path.join(automation.dir, "schema");
      fs.mkdirSync(path.join(schemaDir, "nested"), { recursive: true });
      fs.writeFileSync(path.join(schemaDir, "b.ts"), "b");
      fs.writeFileSync(path.join(schemaDir, "a.mts"), "a");
      fs.writeFileSync(path.join(schemaDir, "nested", "c.ts"), "c");
      const sources = await loadSchemaSources(configFor(schemaDir));
      expect(
         sources.map((item) => [item.relativePath.replaceAll("\\", "/"), item.contents]),
      ).toStrictEqual([
         ["a.mts", "a"],
         ["b.ts", "b"],
         ["nested/c.ts", "c"],
      ]);
      expect(sources[0]?.fullPath).toBe(path.join(schemaDir, "a.mts"));
   });

   it("sorts the files whatever the order in which the directory lists them", async () => {
      const schemaDir = path.join(automation.dir, "schema");
      fs.mkdirSync(schemaDir);
      for (const name of ["a.ts", "b.ts", "c.ts"]) {
         fs.writeFileSync(path.join(schemaDir, name), name);
      }
      vi.spyOn(fsp, "readdir").mockResolvedValue(["c.ts", "a.ts", "b.ts"] as never);
      const sources = await loadSchemaSources(configFor(schemaDir));
      expect(sources.map((item) => item.relativePath)).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
   });

   it("skips files that are not schema sources, and directories named like them", async () => {
      const schemaDir = path.join(automation.dir, "schema");
      fs.mkdirSync(path.join(schemaDir, "folder.ts"), { recursive: true });
      fs.writeFileSync(path.join(schemaDir, "types.d.ts"), "declare const x: number;");
      fs.writeFileSync(path.join(schemaDir, "notes.md"), "notes");
      fs.writeFileSync(path.join(schemaDir, "real.ts"), "real");
      const sources = await loadSchemaSources(configFor(schemaDir));
      expect(sources.map((item) => item.relativePath)).toStrictEqual(["real.ts"]);
   });

   it("has no sources when the schema path is neither a file nor a directory", async () => {
      expect(
         await loadSchemaSources(configFor(path.join(automation.dir, "missing"))),
      ).toStrictEqual([]);
   });
});
