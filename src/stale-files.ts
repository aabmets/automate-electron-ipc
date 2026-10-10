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
import path from "node:path";
import type * as t from "@types";
import { HOOKS_FILE_NAMES } from "./config-outputs.js";
import { GENERATED_PREFIX, LEGACY_NOTICE_PREFIX } from "./output-files.js";
import { scopeOfFile } from "./scopes.js";
import utils from "./utils.js";

/** Tells whether the first line of the file is the header of a generated file. */
async function isGenerated(file: string): Promise<boolean> {
   try {
      const text = await fsp.readFile(file, "utf8");
      return text.startsWith(GENERATED_PREFIX) || text.startsWith(LEGACY_NOTICE_PREFIX);
   } catch {
      return false;
   }
}

/** The files in the directory of `basePath` that are named after a scope of it. */
async function scopedFilesNextTo(basePath: string): Promise<string[]> {
   const dir = path.dirname(basePath);
   const names = await fsp.readdir(dir).catch(() => [] as string[]);
   return names
      .map((name) => utils.toPosix(path.join(dir, name)))
      .filter((file) => scopeOfFile(basePath, file) !== null);
}

/**
 * The files of earlier runs that this run does not generate: the outputs that exist for some
 * schemas only (utility processes, service workers), the files of scopes, the hooks of the
 * `hooks` option and the mock of the `mock` option, minus the outputs of this run. A file is listed
 * only when it starts with the header of a generated file, so that a file written by hand is never
 * touched. A generated file at a custom path that the config no longer names cannot be found.
 *
 * @returns The absolute paths in posix form, sorted.
 */
export async function findStaleGeneratedFiles(
   config: t.IPCResolvedConfig,
   outputs: readonly t.OutputFile[],
): Promise<string[]> {
   const hooks = utils.toPosix(config.hooksFilePath);
   const planned = new Set(outputs.map((output) => output.path));
   const scoped = await Promise.all(
      [config.preloadBindingsFilePath, config.rendererTypesFilePath, config.typesFilePath].map(
         scopedFilesNextTo,
      ),
   );
   const candidates = new Set(
      [
         config.mockFilePath,
         config.utilityBindingsFilePath,
         config.serviceWorkerPreloadFilePath,
         config.serviceWorkerTypesFilePath,
         // The hooks of a framework that the config no longer names.
         ...HOOKS_FILE_NAMES.map((name) => path.posix.join(path.posix.dirname(hooks), name)),
         ...scoped.flat(),
      ].map(utils.toPosix),
   );
   const unplanned = [...candidates].filter((file) => !planned.has(file));
   const generated = await Promise.all(unplanned.map(isGenerated));
   return unplanned.filter((_, index) => generated[index]).sort(utils.comparePaths);
}

/** Deletes the files. A file that is already gone is not an error. */
export async function removeFiles(files: readonly string[]): Promise<void> {
   await Promise.all(files.map((file) => fsp.rm(file, { force: true })));
}
