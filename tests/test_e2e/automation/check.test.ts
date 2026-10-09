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
import { findStaleOutputs } from "@src/check.js";
import { toPosix } from "@src/utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

/** Every file under `dir` with its contents, keyed by relative path. */
async function snapshot(dir: string): Promise<Record<string, string>> {
   const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
   const files = entries.filter((entry) => entry.isFile());
   const pairs = await Promise.all(
      files.map(async (entry) => {
         const full = path.join(entry.parentPath, entry.name);
         return [toPosix(path.relative(dir, full)), await fsp.readFile(full, "utf8")] as const;
      }),
   );
   return Object.fromEntries(pairs.sort(([a], [b]) => (a < b ? -1 : 1)));
}

describe("findStaleOutputs", () => {
   const generatedPath = (dir: string, ipcDataDir: string, name: string) =>
      toPosix(path.join(dir, ipcDataDir, name));

   it("returns an empty list for fresh output", async () => {
      const project = await fixtures.run("single-file");
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);
   });

   it("lists the files that an edited schema changes", async () => {
      const project = await fixtures.run("single-file");
      const schema = path.join(project.dir, project.ipcDataDir, "schema.ts");
      const source = await fsp.readFile(schema, "utf8");
      const edited = source.replace(
         "   chatStream:",
         "   renameUser: send<(name: string) => void>(),\n   chatStream:",
      );
      expect(edited).not.toBe(source);
      await fsp.writeFile(schema, edited);

      expect(await findStaleOutputs({ cwd: project.dir })).toEqual(
         ["main.ts", "preload.ts", "window.d.ts"].map((name) =>
            generatedPath(project.dir, project.ipcDataDir, name),
         ),
      );
   });

   it("lists a deleted output file", async () => {
      const project = await fixtures.run("single-file");
      await fsp.rm(path.join(project.dir, project.ipcDataDir, "preload.ts"));
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([
         generatedPath(project.dir, project.ipcDataDir, "preload.ts"),
      ]);
   });

   it("lists a hand-edited output file, and no other", async () => {
      const project = await fixtures.run("single-file");
      const mainFile = path.join(project.dir, project.ipcDataDir, "main.ts");
      await fsp.appendFile(mainFile, "// edited by hand\n");
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([
         generatedPath(project.dir, project.ipcDataDir, "main.ts"),
      ]);
   });

   it("writes nothing, whatever it finds", async () => {
      const project = await fixtures.run("single-file");
      await fsp.rm(path.join(project.dir, project.ipcDataDir, "window.d.ts"));
      await fsp.appendFile(path.join(project.dir, project.ipcDataDir, "main.ts"), "// edited\n");
      const before = await snapshot(project.dir);

      const stale = await findStaleOutputs({ cwd: project.dir });

      expect(stale).toHaveLength(2);
      expect(await snapshot(project.dir)).toEqual(before);
   });

   it("returns null when the schema does not exist, and creates no directory", async () => {
      const project = await fixtures.run("single-file");
      await fsp.rm(path.join(project.dir, project.ipcDataDir), { recursive: true });
      const before = await snapshot(project.dir);

      expect(await findStaleOutputs({ cwd: project.dir })).toBeNull();

      expect(await snapshot(project.dir)).toEqual(before);
      await expect(fsp.stat(path.join(project.dir, project.ipcDataDir))).rejects.toThrow();
   });
});
