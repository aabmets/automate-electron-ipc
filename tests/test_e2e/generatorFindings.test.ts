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

import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import { type E2EProject, NODE_NEXT_OPTIONS, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("T88: config values which are accepted, but break the output", () => {
   it.fails("refuses an output path that is the schema file, and leaves the schema alone", async () => {
      const failure = await failureOf("output-over-schema");
      expect(failure ?? "the run did not fail").toContain("schema");
      // Without the check, the generated code of the utility process replaced the schema.
      expect(await project?.read("schema.ts")).toBeUndefined();
   });

   it.fails("refuses output paths that are declaration files", async () => {
      // A .d.mts or .d.cts file cannot hold the runtime code of the utility process or the worker.
      expect((await failureOf("declaration-output-paths")) ?? "the run did not fail").toMatch(
         /utilityBindingsPath|\.d\.mts/,
      );
   });

   it.fails("does not keep an allowed origin with the default port, which no origin can match", async () => {
      const failure = await failureOf("default-port-origins");
      const main = project?.generated["main.ts"] ?? "";
      // Either way is fine: the run refuses the entries, or it writes them as origins.
      const outcome =
         failure === null
            ? /localhost:80\b|example\.com:443\b/.test(main)
               ? "kept"
               : "normalized"
            : "refused";
      expect(outcome).not.toBe("kept");
   });
});

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

describe("T92: diagnostics which name the wrong path, or none", () => {
   // The single schema file is reported as its directory, 'ipc'.
   it.fails("names the schema file in an error about one of its channels", async () => {
      expect(await failureOf("schema-file-reserved-name")).toContain("Schema file 'ipc/schema.ts'");
   });

   it.fails("names the package.json which is not valid JSON", async () => {
      const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-e2e-"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
         await fsp.writeFile(path.join(root, "package.json"), '{ "name": "broken", }');
         const failure = await ipcAutomation(root).then(
            () => null,
            (error: Error) => error.message,
         );
         expect(failure).toContain("package.json");
      } finally {
         warn.mockRestore();
         await fsp.rm(root, { recursive: true, force: true });
      }
   });
});
