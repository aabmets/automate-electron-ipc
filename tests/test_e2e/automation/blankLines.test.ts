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
import { FIXTURES, runForGeneratedFiles } from "@testutils/e2e/all-fixtures.js";
import { describe, expect, it } from "vitest";

describe("generated files, blank lines", () => {
   // Regression for T100: the components of preload.ts were joined as they were, so two of them
   // could leave two blank lines in a row between them.
   it.each(FIXTURES)("has no two blank lines in a row in the files of '%s'", async (fixture) => {
      const { project, files } = await runForGeneratedFiles(fixture);
      expect(files).not.toStrictEqual([]);
      for (const file of files) {
         const contents = fs.readFileSync(path.join(project.root, file), "utf8");
         const index = contents.indexOf("\n\n\n");
         expect(
            index,
            `${file}: ${JSON.stringify(contents.slice(Math.max(0, index - 80), index + 80))}`,
         ).toBe(-1);
      }
   });
});
