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
   BASELINE_FILE,
   collectSizes,
   countLines,
   evaluate,
   HARD_LIMIT,
   ratchet,
   readBaseline,
   run,
   SOFT_LIMIT,
   snapshot,
   writeBaseline,
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
      expect(evaluate(sizes({ "src/a.ts": SOFT_LIMIT }), {})).toEqual({ errors: [], warnings: [] });
   });

   it("only warns between the soft and the hard limit", () => {
      const verdict = evaluate(sizes({ "src/a.ts": HARD_LIMIT }), {});
      expect(verdict.errors).toEqual([]);
      expect(verdict.warnings).toHaveLength(1);
      expect(verdict.warnings[0]).toContain("src/a.ts");
   });

   it("rejects a file over the hard limit that the baseline does not list", () => {
      const verdict = evaluate(sizes({ "src/a.ts": HARD_LIMIT + 1 }), {});
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("over the hard limit");
   });

   it("lets a baseline file stay as it is", () => {
      const verdict = evaluate(sizes({ "src/a.ts": 900 }), { "src/a.ts": 900 });
      expect(verdict).toEqual({ errors: [], warnings: [] });
   });

   it("rejects a baseline file that grew by a single line", () => {
      const verdict = evaluate(sizes({ "src/a.ts": 901 }), { "src/a.ts": 900 });
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("grew from 900 to 901");
   });

   it("rejects a baseline file that shrank, so the ratchet cannot go slack", () => {
      const verdict = evaluate(sizes({ "src/a.ts": 800 }), { "src/a.ts": 900 });
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("shrank from 900 to 800");
   });

   it("rejects a baseline file that fits now, and still warns about the soft limit", () => {
      const verdict = evaluate(sizes({ "src/a.ts": 290 }), { "src/a.ts": 900 });
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("Remove it from the baseline");
      expect(verdict.warnings).toHaveLength(1);
   });

   it("rejects a baseline entry for a file which is gone", () => {
      const verdict = evaluate(sizes({}), { "src/gone.ts": 900 });
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("does not exist");
   });

   it("reports in the order of the paths", () => {
      const verdict = evaluate(sizes({ "src/b.ts": 500, "src/a.ts": 500 }), {});
      expect(verdict.errors.map((e) => e.split(":")[0])).toEqual(["src/a.ts", "src/b.ts"]);
   });
});

describe("ratchet and snapshot", () => {
   it("lowers a recorded size to the current one", () => {
      const next = ratchet(new Map([["src/a.ts", 700]]), { "src/a.ts": 900 });
      expect(next).toEqual({ "src/a.ts": 700 });
   });

   it("never raises a recorded size", () => {
      const next = ratchet(new Map([["src/a.ts", 950]]), { "src/a.ts": 900 });
      expect(next).toEqual({ "src/a.ts": 900 });
   });

   it("never adds a file the baseline did not list", () => {
      const next = ratchet(new Map([["src/new.ts", 5000]]), {});
      expect(next).toEqual({});
   });

   it("drops the files which fit the hard limit now, and the ones which are gone", () => {
      const next = ratchet(new Map([["src/a.ts", HARD_LIMIT]]), {
         "src/a.ts": 900,
         "src/gone.ts": 400,
      });
      expect(next).toEqual({});
   });

   it("snapshots the files over the hard limit at their size", () => {
      const sizes = new Map([
         ["src/a.ts", HARD_LIMIT + 1],
         ["src/b.ts", HARD_LIMIT],
      ]);
      expect(snapshot(sizes)).toEqual({ "src/a.ts": HARD_LIMIT + 1 });
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
      expect(readBaseline(cwd)).toEqual({});
   });

   it("writes the baseline sorted, and reads it back", () => {
      writeBaseline(cwd, { "src/b.ts": 400, "src/a.ts": 500 });
      const text = fs.readFileSync(path.join(cwd, BASELINE_FILE), "utf8");
      expect(text.indexOf("src/a.ts")).toBeLessThan(text.indexOf("src/b.ts"));
      expect(readBaseline(cwd)).toEqual({ "src/a.ts": 500, "src/b.ts": 400 });
   });

   it("fails the run for an oversized file, and passes once the baseline lists it", () => {
      put("src/big.ts", lines(HARD_LIMIT + 20));
      const failing = run([], cwd);
      expect(failing.code).toBe(1);
      expect(failing.output[0]).toContain("error: src/big.ts");

      writeBaseline(cwd, snapshot(collectSizes(cwd)));
      expect(run([], cwd)).toEqual({ code: 0, output: [] });
   });

   it("fails the run when a baseline file shrank, and --update then fixes the baseline", () => {
      put("src/big.ts", lines(HARD_LIMIT + 20));
      writeBaseline(cwd, { "src/big.ts": HARD_LIMIT + 50 });
      expect(run([], cwd).code).toBe(1);
      expect(run(["--update"], cwd).code).toBe(0);
      expect(readBaseline(cwd)).toEqual({ "src/big.ts": HARD_LIMIT + 20 });
   });

   it("does not let --update hide a file that grew", () => {
      put("src/big.ts", lines(HARD_LIMIT + 50));
      writeBaseline(cwd, { "src/big.ts": HARD_LIMIT + 20 });
      const result = run(["--update"], cwd);
      expect(result.code).toBe(1);
      expect(readBaseline(cwd)).toEqual({ "src/big.ts": HARD_LIMIT + 20 });
   });

   it("only warns about a file between the limits", () => {
      put("src/ok.ts", lines(SOFT_LIMIT + 5));
      const result = run([], cwd);
      expect(result.code).toBe(0);
      expect(result.output).toEqual([expect.stringContaining("warning: src/ok.ts")]);
   });
});
