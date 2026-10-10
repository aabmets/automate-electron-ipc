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

export const SOFT_LIMIT = 280;
export const HARD_LIMIT = 300;
export const ROOTS = ["src", "tests", "types"];
export const EXEMPT_PREFIXES = ["tests/fixtures/"];

const SOURCE_FILE = /\.[cm]?[tj]s$/;
const LICENSE_HEADER = /^\/\*[\s\S]*?\*\/[ \t]*\r?\n(?:\r?\n)?/;

export interface Verdict {
   errors: string[];
   warnings: string[];
}

/** Lines of a source file, not counting its leading license header. */
export function countLines(text: string): number {
   const body = text.replace(LICENSE_HEADER, "");
   if (body === "") {
      return 0;
   }
   const lines = body.split("\n");
   return body.endsWith("\n") ? lines.length - 1 : lines.length;
}

/** The size of every checked file below `cwd`, keyed by its posix path relative to `cwd`. */
export function collectSizes(cwd: string): Map<string, number> {
   const sizes = new Map<string, number>();
   for (const root of ROOTS) {
      const dir = path.join(cwd, root);
      if (!fs.existsSync(dir)) {
         continue;
      }
      for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
         if (!(entry.isFile() && SOURCE_FILE.test(entry.name))) {
            continue;
         }
         const full = path.join(entry.parentPath, entry.name);
         const rel = path.relative(cwd, full).split(path.sep).join("/");
         if (rel.includes("node_modules/") || EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) {
            continue;
         }
         sizes.set(rel, countLines(fs.readFileSync(full, "utf8")));
      }
   }
   return sizes;
}

/**
 * Judges the sizes against the limits. A file over the hard limit is an error. A file over the soft
 * limit only draws a warning, because whether a split above 30 lines exists is a judgement.
 */
export function evaluate(sizes: Map<string, number>): Verdict {
   const errors: string[] = [];
   const warnings: string[] = [];
   for (const [file, lines] of [...sizes].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (lines > HARD_LIMIT) {
         errors.push(`${file}: ${lines} lines, over the hard limit of ${HARD_LIMIT}. Split it.`);
      } else if (lines > SOFT_LIMIT) {
         warnings.push(
            `${file}: ${lines} lines, over the soft limit of ${SOFT_LIMIT}. Split it, unless every split would be a stub of 30 lines or fewer.`,
         );
      }
   }
   return { errors, warnings };
}

export function run(cwd: string): { code: number; output: string[] } {
   const sizes = collectSizes(cwd);
   const { errors, warnings } = evaluate(sizes);
   const output = [
      ...errors.map((line) => `error: ${line}`),
      ...warnings.map((line) => `warning: ${line}`),
   ];
   return { code: errors.length > 0 ? 1 : 0, output };
}
