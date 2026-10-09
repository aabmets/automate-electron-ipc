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

import type { IPCOptionalConfig, IPCResolvedConfig } from "./internal-config.js";
import type { ParsedFileSpecs } from "./internal-specs.js";

/** One generated file: the absolute path in posix form, and the full text with the notice. */
export interface OutputFile {
   path: string;
   contents: string;
}

/** Options of a run. */
export interface RunOptions {
   /** Directory to find the project root from. Defaults to the process working directory. */
   cwd?: string;
   /** The config file to read, instead of the `autoipc.config.*` file in the project root. */
   configFile?: string;
   /** Config options that win over the config source and the defaults. */
   overrides?: IPCOptionalConfig;
}

/** What a run generates: the resolved config, the parsed schema, and the files to write. */
export interface RunPlan {
   config: IPCResolvedConfig;
   pfsArray: ParsedFileSpecs[];
   outputs: OutputFile[];
}
