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

import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

const defaultTsc = path.join(root, "node_modules/.bin/tsc");

/** The import of every verb that the schemas of the type tests use from the public types. */
export const SCHEMA_IMPORT =
   'import { defineChannels, invoke, send, emit, ask, stream, port, mainPort } from "automate-electron-ipc";';

/**
 * Runs tsc on the project in `dir` and returns its diagnostics, which are empty for a clean run.
 * Throws if tsc does not run to completion: it could not start, it was killed, or it failed
 * without a diagnostic. Otherwise a crash would give an empty result, which means "no errors".
 * `tsc` is the executable to run, which is only replaced by the tests of this helper.
 */
export function runTsc(dir: string, tsc = defaultTsc): string {
   const result = spawnSync(tsc, ["-p", dir, "--pretty", "false"], { encoding: "utf8" });
   if (result.error) {
      throw new Error(`tsc could not run: ${result.error.message}`);
   } else if (result.signal) {
      throw new Error(`tsc was killed by signal ${result.signal}`);
   }
   const output = `${result.stdout}${result.stderr}`.trim();
   // tsc exits with 0 when there are no errors, and with 1 or 2 when it reports diagnostics.
   if (![0, 1, 2].includes(result.status ?? -1)) {
      throw new Error(`tsc exited with status ${result.status}: ${output}`);
   } else if (result.status !== 0 && output === "") {
      throw new Error(`tsc exited with status ${result.status} and printed no diagnostics`);
   }
   return output;
}

/**
 * Type-checks the given source files against the public types of this library,
 * which are importable as "automate-electron-ipc". Returns the tsc diagnostics.
 */
export async function typecheck(files: Record<string, string>): Promise<string> {
   const dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-tsc-"));
   try {
      await Promise.all(
         Object.entries(files).map(([name, contents]) =>
            fsp.writeFile(path.join(dir, name), contents),
         ),
      );
      const tsconfig = {
         compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            skipLibCheck: true,
            types: [],
            paths: {
               "automate-electron-ipc": [path.join(root, "types/index.d.ts")],
               "automate-electron-ipc/api": [path.join(root, "types/api.d.ts")],
            },
         },
         files: Object.keys(files),
      };
      await fsp.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
      return runTsc(dir);
   } finally {
      await fsp.rm(dir, { recursive: true, force: true });
   }
}
