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

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { notice } from "@src/output-files.js";
import { FIXTURES, runForGeneratedFiles } from "@testutils/e2e/all-fixtures.js";
import type * as t from "@types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const biome = path.resolve(import.meta.dirname, "../../../node_modules/.bin/biome");
/** Lint only: the generated code has its own indents and quotes, so the formatter rules of the repo do not apply. */
const LINT_ONLY = JSON.stringify({
   formatter: { enabled: false },
   assist: { enabled: false },
   linter: { enabled: true, rules: { recommended: true } },
});

/**
 * The rules that the generated code breaks on purpose. The typings of a schema are loose where the
 * type of a channel is not known (`any`, `{}`, `Function`), the code is written for the output
 * of any schema, so it keeps helpers that a given schema does not use, and the names of the
 * identifiers of the schema are copied, whatever they shadow, and a type that only a `@throws` tag
 * of the typings names is imported all the same. The header turns the lint off for
 * these; any other rule that finds something is a mistake in the generator.
 */
const INHERENT_RULES = new Set([
   "lint/suspicious/noExplicitAny",
   "lint/suspicious/noEmptyInterface",
   "lint/suspicious/noRedeclare",
   "lint/suspicious/noShadowRestrictedNames",
   "lint/complexity/noBannedTypes",
   "lint/complexity/noUselessEmptyExport",
   "lint/complexity/useLiteralKeys",
   "lint/complexity/useOptionalChain",
   "lint/correctness/noUnusedImports",
   "lint/correctness/noUnusedVariables",
]);

/** The rules of the diagnostics that `biome lint` reports for the files, from `cwd`. */
async function lintRules(configDir: string, cwd: string, files: string[]): Promise<string[]> {
   const args = ["lint", `--config-path=${configDir}`, "--reporter=json", "--max-diagnostics=none"];
   // Biome exits with 1 when it finds an error, and the report is on stdout all the same.
   const { stdout } = await run(biome, [...args, ...files], { cwd }).catch((error) => error);
   const report = JSON.parse(stdout.slice(stdout.indexOf("{")));
   return report.diagnostics.map((diagnostic: { category: string }) => diagnostic.category);
}

describe("generated files, Biome lint", () => {
   let configDir = "";
   beforeAll(async () => {
      configDir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-biome-lint-"));
      await fsp.writeFile(path.join(configDir, "biome.json"), LINT_ONLY);
   });
   afterAll(() => fsp.rm(configDir, { recursive: true, force: true }));

   it("accepts the header as a suppression of the lint of the whole file", async () => {
      const config = { projectRoot: "/p", ipcSchema: { path: "/p/schema.ts" } };
      const header = notice(config as t.IPCResolvedConfig);
      const code = "export function f(): void {\n   debugger;\n}\n";
      await fsp.writeFile(path.join(configDir, "with.ts"), `${header}\n\n${code}`);
      await fsp.writeFile(path.join(configDir, "without.ts"), code);

      expect(await lintRules(configDir, configDir, ["with.ts"])).toStrictEqual([]);
      expect(await lintRules(configDir, configDir, ["without.ts"])).toStrictEqual([
         "lint/suspicious/noDebugger",
      ]);
   });

   it.each(FIXTURES)(
      "has nothing for the linter to flag in the files of '%s', and no unexpected rule without the header",
      async (fixture) => {
         const { project, files } = await runForGeneratedFiles(fixture);
         const generated = files.filter((file) => file.endsWith(".ts"));
         expect(generated).not.toStrictEqual([]);

         expect(await lintRules(configDir, project.root, generated)).toStrictEqual([]);

         await Promise.all(
            generated.map(async (file) => {
               const full = path.join(project.root, file);
               const text = await fsp.readFile(full, "utf8");
               await fsp.writeFile(full, text.replace(/^\/\/ biome-ignore-all .*\n/gm, ""));
            }),
         );
         const rules = await lintRules(configDir, project.root, generated);
         expect(rules.filter((rule) => !INHERENT_RULES.has(rule))).toStrictEqual([]);
      },
   );
});
