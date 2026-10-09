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
import path from "node:path";
import { type E2EProject, type RunFixtureOptions, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it } from "vitest";

const fixturesDir = path.resolve(import.meta.dirname, "../fixtures");

/** The fixtures whose schema or config the run rejects, so that they generate nothing. */
const REJECTED = new Set([
   "declaration-output-paths",
   "default-port-origins",
   "duplicate-channels",
   "export-equals",
   "output-over-schema",
   "schema-file-reserved-name",
   "syntax-error",
]);

/** The options of the fixtures whose project is not the root of the fixture. */
const OPTIONS: Record<string, RunFixtureOptions> = {
   workspace: { project: "packages/app" },
};

/** Every fixture which generates its files. */
const FIXTURES = fs
   .readdirSync(fixturesDir)
   .filter((name) => !REJECTED.has(name))
   .sort();

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** The paths of the files under `dir`, relative to it, with `/` as the separator. */
function listFiles(dir: string): string[] {
   return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .map((file) => file.replaceAll("\\", "/"));
}

describe("generated files, blank lines", () => {
   // Regression for T100: the components of preload.ts were joined as they were, so two of them
   // could leave two blank lines in a row between them.
   it.each(FIXTURES)("has no two blank lines in a row in the files of '%s'", async (fixture) => {
      const fixtureFiles = new Set(listFiles(path.join(fixturesDir, fixture)));
      project = await runFixture(fixture, OPTIONS[fixture]);
      const generatedFiles = listFiles(project.root).filter((file) => !fixtureFiles.has(file));
      expect(generatedFiles).not.toStrictEqual([]);
      for (const file of generatedFiles) {
         const contents = fs.readFileSync(path.join(project.root, file), "utf8");
         const index = contents.indexOf("\n\n\n");
         expect(
            index,
            `${file}: ${JSON.stringify(contents.slice(Math.max(0, index - 80), index + 80))}`,
         ).toBe(-1);
      }
   });
});
