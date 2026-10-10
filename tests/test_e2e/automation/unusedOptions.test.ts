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

import { FIXTURES, runForGeneratedFiles } from "@testutils/e2e/all-fixtures.js";
import { describe, expect, it } from "vitest";

/**
 * The fixtures that the type-check cannot take as they are, for reasons that have nothing to do
 * with unused code: their imports use a path alias or `import x = require()`, which need options
 * of their own.
 */
const SKIPPED = new Set(["directory-packages", "export-equals", "import-equals-require"]);

/** The options that the base config of the electron-vite template turns on. */
const STRICT = { noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true };

describe("generated files, unused locals and parameters", () => {
   it.each(FIXTURES.filter((fixture) => !SKIPPED.has(fixture)))(
      "type-checks the files of '%s' with noUnusedLocals, noUnusedParameters and noImplicitReturns",
      async (fixture) => {
         const { project } = await runForGeneratedFiles(fixture);
         expect(await project.typecheck(STRICT)).toBe("");
      },
      60_000,
   );
});
