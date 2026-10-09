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

// Bugs of the generator that the review of 2026-10-09 found, one `describe` per task. Each test is
// an `it.fails` until its task fixes the bug, and then moves to the tests of its feature.

import { type E2EProject, NODE_NEXT_OPTIONS, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** Runs the fixture, and returns the message of the error that the run failed with, or `null`. */
async function failureOf(fixture: string): Promise<string | null> {
   try {
      project = await runFixture(fixture);
      return null;
   } catch (error) {
      return error instanceof Error ? error.message : String(error);
   }
}

describe("T89: import paths of the generated files", () => {
   it("generates the files of schema files with script extensions", async () => {
      project = await runFixture("script-extensions");
      expect(project.generated["main.ts"]).toContain("getAccount");
      expect(project.generated["main.ts"]).toContain("getUser");
   });

   // The import of the types of `api.mts` drops the extension: "./schema/api", which does not
   // resolve, and `./models.mjs` loses its extension as well.
   it.fails("type-checks imports of .mts schema files and .mjs modules", async () => {
      project = await runFixture("script-extensions");
      expect(await project.typecheck()).toBe("");
   });

   it.fails("keeps the specifier of a JSON module under NodeNext, without a script extension", async () => {
      project = await runFixture("json-import-node-next");
      expect(project.generated["main.ts"]).not.toContain("settings.json.js");
      expect(await project.typecheck({ ...NODE_NEXT_OPTIONS, resolveJsonModule: true })).toBe("");
   });

   // The path of `import("./models")` is relative to the schema file, and is copied as it is into
   // the generated files, which are in another directory.
   it.fails("rebases the path of an import type to the generated files", async () => {
      project = await runFixture("inline-import-types");
      expect(project.generated["main.ts"]).not.toContain('import("./models")');
      expect(await project.typecheck()).toBe("");
   });
});

describe("T90: TypeScript syntax that the schema parser does not support", () => {
   // swc parses without `decorators: true`.
   it.fails("parses a schema file with a decorated class", async () => {
      expect(await failureOf("decorators")).toBeNull();
      expect(await project?.typecheck({ experimentalDecorators: false })).toBe("");
   });

   // `export import User = Models.User` binds a name that the generated files do not import.
   it.fails("binds a name that import-equals declares", async () => {
      project = await runFixture("import-equals");
      expect(await project.typecheck()).toBe("");
   });
});
