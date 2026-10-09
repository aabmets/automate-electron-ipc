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
export const BASELINE_FILE = "size-baseline.json";

const SOURCE_FILE = /\.[cm]?[tj]s$/;
const LICENSE_HEADER = /^\/\*[\s\S]*?\*\/[ \t]*\r?\n(?:\r?\n)?/;

export type Baseline = Record<string, number>;

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

export function readBaseline(cwd: string): Baseline {
   const file = path.join(cwd, BASELINE_FILE);
   return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

export function writeBaseline(cwd: string, baseline: Baseline): void {
   const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => (a < b ? -1 : 1)));
   fs.writeFileSync(path.join(cwd, BASELINE_FILE), `${JSON.stringify(sorted, null, 3)}\n`);
}

/**
 * Judges the sizes against the limits. A file over the hard limit is an error, unless the baseline
 * lists it, and then it may only get smaller. The baseline itself may not go stale. A file over the
 * soft limit only draws a warning, because whether a split above 30 lines exists is a judgement.
 */
export function evaluate(sizes: Map<string, number>, baseline: Baseline): Verdict {
   const errors: string[] = [];
   const warnings: string[] = [];
   for (const [file, lines] of [...sizes].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const recorded = baseline[file];
      if (lines > HARD_LIMIT) {
         if (recorded === undefined) {
            errors.push(`${file}: ${lines} lines, over the hard limit of ${HARD_LIMIT}. Split it.`);
         } else if (lines > recorded) {
            errors.push(
               `${file}: grew from ${recorded} to ${lines} lines. It is over the hard limit, so it may only shrink.`,
            );
         } else if (lines < recorded) {
            errors.push(
               `${file}: shrank from ${recorded} to ${lines} lines. Lower its baseline (bun scripts/check-size.ts --update).`,
            );
         }
         continue;
      }
      if (recorded !== undefined) {
         errors.push(
            `${file}: ${lines} lines, within the limit now. Remove it from the baseline (bun scripts/check-size.ts --update).`,
         );
      }
      if (lines > SOFT_LIMIT) {
         warnings.push(
            `${file}: ${lines} lines, over the soft limit of ${SOFT_LIMIT}. Split it, unless every split would be a stub of 30 lines or fewer.`,
         );
      }
   }
   for (const file of Object.keys(baseline)) {
      if (!sizes.has(file)) {
         errors.push(
            `${file}: listed in ${BASELINE_FILE}, but the file does not exist. Remove it from the baseline.`,
         );
      }
   }
   return { errors, warnings };
}

/** Lowers the baseline to the current sizes and drops the files that fit. It never adds or raises. */
export function ratchet(sizes: Map<string, number>, baseline: Baseline): Baseline {
   const next: Baseline = {};
   for (const [file, recorded] of Object.entries(baseline)) {
      const lines = sizes.get(file);
      if (lines !== undefined && lines > HARD_LIMIT) {
         next[file] = Math.min(recorded, lines);
      }
   }
   return next;
}

/** The baseline for the current sizes: every file over the hard limit, at its size. */
export function snapshot(sizes: Map<string, number>): Baseline {
   return Object.fromEntries([...sizes].filter(([, lines]) => lines > HARD_LIMIT));
}

export function run(argv: string[], cwd: string): { code: number; output: string[] } {
   const sizes = collectSizes(cwd);
   if (argv.includes("--update")) {
      writeBaseline(cwd, ratchet(sizes, readBaseline(cwd)));
   }
   const { errors, warnings } = evaluate(sizes, readBaseline(cwd));
   const output = [
      ...errors.map((line) => `error: ${line}`),
      ...warnings.map((line) => `warning: ${line}`),
   ];
   return { code: errors.length > 0 ? 1 : 0, output };
}
