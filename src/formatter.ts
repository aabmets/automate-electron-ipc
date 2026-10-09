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
import { existsSync } from "node:fs";
import path from "node:path";
import type * as t from "@types";
import logger from "./logger.js";
import utils from "./utils.js";

/** What the formatter call needs from a finished process; `spawnSync` returns a superset. */
export interface FormatterResult {
   status: number | null;
   stdout: string;
   stderr: string;
   error?: Error;
}

/** Runs `command` with `input` on its stdin. Injectable, so that tests need no formatter binary. */
export type SpawnFunction = (
   command: string,
   args: string[],
   options: { cwd: string; input: string; shell: boolean },
) => FormatterResult;

/** Formats the text of the file at the absolute path `file`, and returns the formatted text. */
export type FormatFunction = (file: string, text: string) => string;

const IS_WINDOWS = process.platform === "win32";

const defaultSpawn: SpawnFunction = (command, args, options) =>
   spawnSync(command, args, { ...options, encoding: "utf8" });

/** The arguments that make the formatter read the text from stdin and write it to stdout. */
function formatterArgs(formatter: "biome" | "prettier", file: string): string[] {
   return formatter === "biome"
      ? ["format", `--stdin-file-path=${file}`]
      : ["--stdin-filepath", file];
}

/**
 * Makes the function that formats the generated files with the formatter of the user project, or
 * `null` when the config does not ask for one. The binary comes from `node_modules/.bin` of the
 * project root and runs with the project root as its working directory, so the config of the user
 * applies; it is never imported. A missing binary is reported once, and the function then returns
 * the text as it is. A formatter that fails is an error that names the file.
 *
 * @param config - The resolved config.
 * @param [spawn] - Runs the process; replaced by tests.
 */
export function createFormatter(
   config: Pick<t.IPCResolvedConfig, "format" | "projectRoot">,
   spawn: SpawnFunction = defaultSpawn,
): FormatFunction | null {
   const formatter = config.format;
   if (!formatter) {
      return null;
   }
   const binary = path.join(config.projectRoot, "node_modules", ".bin", formatter);
   const command = IS_WINDOWS ? `${binary}.cmd` : binary;
   // On Windows a missing `.cmd` file makes the shell answer, so it is looked for first.
   let missing = IS_WINDOWS && !existsSync(command);
   let warned = false;
   return (file, text) => {
      if (!missing) {
         const relative = utils.toPosix(path.relative(config.projectRoot, file));
         const result = spawn(command, formatterArgs(formatter, relative), {
            cwd: config.projectRoot,
            input: text,
            shell: IS_WINDOWS,
         });
         missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
         if (!missing) {
            if (result.error || result.status !== 0) {
               const reason = result.error?.message ?? result.stderr.trim();
               throw new Error(`The formatter '${formatter}' failed on '${relative}':\n${reason}`);
            }
            return result.stdout;
         }
      }
      if (!warned) {
         warned = true;
         logger.formatterMissing(formatter, utils.toPosix(binary), config.projectRoot);
      }
      return text;
   };
}
