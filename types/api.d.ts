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

import type { AutoIpcConfig } from "./config-file.js";

/** The options of a run of the generator, as the CLI takes them. */
export interface ApiRunOptions {
   /** Directory to find the project root from. Defaults to the process working directory. */
   cwd?: string;
   /**
    * The config file to read, relative to `cwd` or absolute, instead of the `autoipc.config.*` file
    * in the project root.
    */
   configFile?: string;
   /** Config options that win over the config source and the defaults. */
   overrides?: AutoIpcConfig;
}

export interface GenerateOptions extends ApiRunOptions {
   /**
    * Prints the same lines as the CLI. The API is silent by default, and it never sets
    * `process.exitCode`: it throws on errors.
    */
   logger?: boolean;
}

export interface GenerateResult {
   /** The absolute paths of the files that were written, with `/` separators, sorted. */
   files: string[];
   /** The number of channels in the schema. */
   channels: number;
}

export interface CheckResult {
   /** The absolute paths of the generated files that are out of date or missing, sorted. */
   stale: string[];
}

/**
 * Generates the bindings of the project, like `ipcgen`. Throws when the schema path does not exist
 * (and does not create the directory), and on every other error of a run.
 */
export function generate(options?: GenerateOptions): Promise<GenerateResult>;

/**
 * Compares the generated files with the ones on disk, like `ipcgen --check`, and writes nothing.
 * Throws when the schema path does not exist.
 */
export function check(options?: GenerateOptions): Promise<CheckResult>;
