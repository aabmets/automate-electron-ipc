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

import path from "node:path";
import type * as t from "@types";
import utils from "./utils.js";

/** The values of the flags of `ipcgen`, as commander reads them. */
export interface CliFlags {
   cwd?: string;
   config?: string;
   outMain?: string;
   outPreload?: string;
   outTypes?: string;
   check?: boolean;
   watch?: boolean;
}

/** The config option that each `--out-*` flag sets. */
const OUTPUT_FLAGS = [
   ["outMain", "mainBindingsPath"],
   ["outPreload", "preloadBindingsPath"],
   ["outTypes", "rendererTypesPath"],
] as const;

/**
 * Turns the flags into the options of a run. The path of an `--out-*` flag is relative to the
 * working directory of the run, which `--cwd` names, but the config holds paths relative to the
 * project root, so the path is converted. Returns `overrides` only when a flag sets an option.
 */
export function flagsToRunOptions(flags: CliFlags): t.RunOptions {
   const overrides: t.IPCOptionalConfig = {};
   for (const [flag, option] of OUTPUT_FLAGS) {
      const value = flags[flag];
      if (value !== undefined) {
         const projectRoot = utils.resolveUserProjectPath("", flags.cwd);
         const file = path.resolve(flags.cwd ?? process.cwd(), value);
         overrides[option] = utils.toPosix(path.relative(projectRoot, file));
      }
   }
   return {
      cwd: flags.cwd,
      configFile: flags.config,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
   };
}
