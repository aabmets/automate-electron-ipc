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

import fsp from "node:fs/promises";
import type * as t from "@types";
import { planRun } from "./automation.js";
import utils from "./utils.js";

/** Tells whether the file holds exactly `contents`. A file that cannot be read does not. */
async function matchesOnDisk(output: t.OutputFile): Promise<boolean> {
   try {
      const onDisk = await fsp.readFile(output.path);
      return onDisk.equals(Buffer.from(output.contents));
   } catch {
      return false;
   }
}

/**
 * Renders the output files in memory and compares each with the bytes on disk, without writing
 * anything. A file that does not exist is stale, and so is a generated file of an earlier run that a run
 * would delete.
 *
 * @param [options] - The options of the run, as for `ipcAutomation`.
 * @returns The absolute paths, in posix form and sorted, of the files that a run would change or
 * create; an empty array when the files are up to date; `null` when the schema path does not exist.
 */
export async function findStaleOutputs(options?: t.RunOptions): Promise<string[] | null> {
   const plan = await planRun(options);
   if (plan === null) {
      return null;
   }
   const matches = await Promise.all(plan.outputs.map(matchesOnDisk));
   return [
      ...plan.outputs.filter((_, index) => !matches[index]).map((output) => output.path),
      ...plan.staleFiles,
   ].sort(utils.comparePaths);
}
