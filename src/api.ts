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

import type * as t from "../types/api.js";
import { applyPlan, planRun } from "./automation.js";
import { findStaleOutputs } from "./check.js";
import cfg from "./config.js";
import logger from "./logger.js";
import utils from "./utils.js";

/**
 * Runs `task` with the logger off, unless `options.logger` is set, and puts the logger back the way
 * it was, whether `task` returns or throws.
 */
async function withLogger<T>(options: t.GenerateOptions, task: () => Promise<T>): Promise<T> {
   const previous = logger.setSilent(options.logger !== true);
   try {
      return await task();
   } finally {
      logger.setSilent(previous);
   }
}

/** The error of a run whose schema path does not exist. The API never makes the directory. */
async function missingSchemaError(options: t.ApiRunOptions): Promise<Error> {
   const { ipcSchema } = await cfg.getResolvedConfig(options);
   return new Error(logger.nonExistentSchemaMessage(ipcSchema.path));
}

/**
 * Generates the IPC bindings of a project, like `ipcgen` does, but silent and without touching
 * `process.exitCode`. It throws instead: when the schema path does not exist (the directory is not
 * made), and for every other error of a run.
 *
 * @param [options] - The options of the run. `logger: true` prints the lines of the CLI.
 * @returns The absolute paths of the written files, sorted, and the number of channels.
 */
export function generate(options: t.GenerateOptions = {}): Promise<t.GenerateResult> {
   return withLogger(options, async () => {
      const plan = await planRun(options);
      if (plan === null) {
         throw await missingSchemaError(options);
      }
      await applyPlan(plan);
      return {
         files: plan.outputs.map((output) => output.path).sort(utils.comparePaths),
         channels: plan.pfsArray.reduce((sum, pfs) => sum + pfs.specs.channelSpecArray.length, 0),
      };
   });
}

/**
 * Compares the generated files of a project with the ones on disk, like `ipcgen --check`, and
 * writes nothing. It throws when the schema path does not exist.
 *
 * @param [options] - The options of the run. `logger: true` prints the lines of the CLI.
 * @returns The absolute paths of the files that are out of date or missing, sorted.
 */
export function check(options: t.GenerateOptions = {}): Promise<t.CheckResult> {
   return withLogger(options, async () => {
      const stale = await findStaleOutputs(options);
      if (stale === null) {
         throw await missingSchemaError(options);
      }
      const { projectRoot } = await cfg.getResolvedConfig(options);
      logger.staleFiles(stale, projectRoot);
      return { stale };
   });
}
