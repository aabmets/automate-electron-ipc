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
import type { E2EProject, RunFixtureOptions } from "../e2e-utils.js";
import { fixtures } from "../fixture-tracker.js";

const fixturesDir = path.resolve(import.meta.dirname, "../../fixtures");

/** The fixtures whose schema or config the run rejects, so that they generate nothing. */
const REJECTED = new Set([
   "declaration-output-paths",
   "default-port-origins",
   "duplicate-channels",
   "output-over-schema",
   "schema-file-reserved-name",
   "syntax-error",
]);

/** The options of the fixtures whose project is not the root of the fixture. */
const OPTIONS: Record<string, RunFixtureOptions> = {
   "config-file-ts": { ipcDataDir: "ipc" },
   workspace: { project: "packages/app" },
};

/** Every fixture which generates its files. */
export const FIXTURES = fs
   .readdirSync(fixturesDir)
   .filter((name) => !REJECTED.has(name))
   .sort();

/** The paths of the files under `dir`, relative to it, with `/` as the separator. */
function listFiles(dir: string): string[] {
   return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .map((file) => file.replaceAll("\\", "/"));
}

/**
 * Runs the fixture, and returns the project with the paths of the files that the run generated,
 * relative to its root, which are the files that the fixture does not have.
 */
export async function runForGeneratedFiles(
   fixture: string,
): Promise<{ project: E2EProject; files: string[] }> {
   const fixtureFiles = new Set(listFiles(path.join(fixturesDir, fixture)));
   const project = await fixtures.run(fixture, OPTIONS[fixture]);
   return { project, files: listFiles(project.root).filter((file) => !fixtureFiles.has(file)) };
}
