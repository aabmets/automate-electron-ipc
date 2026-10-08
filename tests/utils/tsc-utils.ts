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

export function runTsc(dir: string): string {
   const tsc = path.join(root, "node_modules/.bin/tsc");
   const result = spawnSync(tsc, ["-p", dir, "--pretty", "false"], { encoding: "utf8" });
   return `${result.stdout}${result.stderr}`.trim();
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
            paths: { "automate-electron-ipc": [path.join(root, "types/index.d.ts")] },
         },
         files: Object.keys(files),
      };
      await fsp.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
      return runTsc(dir);
   } finally {
      await fsp.rm(dir, { recursive: true, force: true });
   }
}
