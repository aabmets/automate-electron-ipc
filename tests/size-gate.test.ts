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
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
   collectSizes,
   countLines,
   evaluate,
   HARD_LIMIT,
   run,
   SOFT_LIMIT,
} from "../scripts/size-gate.js";

const HEADER = "/*\n *   Apache License 2.0\n *\n *   SPDX-License-Identifier: Apache-2.0\n */\n\n";

function lines(count: number): string {
   return Array.from({ length: count }, (_, i) => `const a${i} = ${i};\n`).join("");
}

describe("countLines", () => {
   it("does not count the license header or the blank line after it", () => {
      expect(countLines(`${HEADER}${lines(5)}`)).toBe(5);
   });

   it("counts a file without a header, and without a final newline", () => {
      expect(countLines("a\nb\nc")).toBe(3);
      expect(countLines("a\nb\nc\n")).toBe(3);
   });

   it("counts a block comment which is not the first thing in the file", () => {
      expect(countLines("const a = 1;\n/* one\n two */\n")).toBe(3);
   });

   it("counts an empty file, and a file with only a header, as zero", () => {
      expect(countLines("")).toBe(0);
      expect(countLines(HEADER)).toBe(0);
   });

   it("handles CRLF line endings after the header", () => {
      expect(countLines(`/* x */\r\n\r\na\r\nb\r\n`)).toBe(2);
   });
});

describe("evaluate", () => {
   const sizes = (entries: Record<string, number>) => new Map(Object.entries(entries));

   it("accepts files within the soft limit without a word", () => {
      expect(evaluate(sizes({ "src/a.ts": SOFT_LIMIT }))).toEqual({ errors: [], warnings: [] });
   });

   it("only warns between the soft and the hard limit", () => {
      const verdict = evaluate(sizes({ "src/a.ts": HARD_LIMIT }));
      expect(verdict.errors).toEqual([]);
      expect(verdict.warnings).toHaveLength(1);
      expect(verdict.warnings[0]).toContain("src/a.ts");
   });

   it("rejects a file over the hard limit", () => {
      const verdict = evaluate(sizes({ "src/a.ts": HARD_LIMIT + 1 }));
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("over the hard limit");
   });

   it("reports in the order of the paths", () => {
      const verdict = evaluate(sizes({ "src/b.ts": 500, "src/a.ts": 500 }));
      expect(verdict.errors.map((e) => e.split(":")[0])).toEqual(["src/a.ts", "src/b.ts"]);
   });
});

describe("on disk", () => {
   let cwd: string;

   function put(rel: string, content: string): void {
      const file = path.join(cwd, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
   }

   beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), "size-gate-"));
   });

   afterEach(() => {
      fs.rmSync(cwd, { recursive: true, force: true });
   });

   it("collects source files of src, tests and types, and skips fixtures and other files", () => {
      put("src/a.ts", lines(3));
      put("src/deep/b.ts", lines(4));
      put("tests/c.test.ts", lines(5));
      put("tests/utils/runner.cjs", lines(6));
      put("types/index.d.ts", lines(7));
      put("tests/fixtures/big/schema.ts", lines(1000));
      put("src/notes.md", lines(1000));
      put("scripts/ignored.ts", lines(1000));
      expect(Object.fromEntries(collectSizes(cwd))).toEqual({
         "src/a.ts": 3,
         "src/deep/b.ts": 4,
         "tests/c.test.ts": 5,
         "tests/utils/runner.cjs": 6,
         "types/index.d.ts": 7,
      });
   });

   it("copes with a project which has none of the roots", () => {
      expect(collectSizes(cwd).size).toBe(0);
   });

   it("fails the run for an oversized file, and passes once it is split", () => {
      put("src/big.ts", lines(HARD_LIMIT + 20));
      const failing = run(cwd);
      expect(failing.code).toBe(1);
      expect(failing.output[0]).toContain("error: src/big.ts");

      put("src/big.ts", lines(HARD_LIMIT));
      expect(run(cwd).code).toBe(0);
   });

   it("only warns about a file between the limits", () => {
      put("src/ok.ts", lines(SOFT_LIMIT + 5));
      const result = run(cwd);
      expect(result.code).toBe(0);
      expect(result.output).toEqual([expect.stringContaining("warning: src/ok.ts")]);
   });
});
