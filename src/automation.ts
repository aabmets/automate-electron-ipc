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
import cfg from "./config.js";
import logger from "./logger.js";
import { writeOutputs } from "./output-files.js";
import { parseSpecs } from "./parser/parser.js";
import { loadSchemaSources } from "./schema-sources.js";
import { collectScopes, filterByScope, scopedFilePath } from "./scopes.js";
import utils from "./utils.js";
import { getCloneWarnings } from "./validation/clone-issues.js";
import {
   validateGlobalChannelSpecs,
   validateReservedApiNames,
} from "./validation/global-validation.js";
import type { BaseWriter } from "./writer/base-writer.js";
import { MainBindingsWriter } from "./writer/main/main-bindings.js";
import { PreloadBindingsWriter } from "./writer/preload/preload-bindings.js";
import { ServiceWorkerPreloadWriter } from "./writer/preload/service-worker-preload.js";
import { RendererTypesWriter } from "./writer/renderer/renderer-types.js";
import { ServiceWorkerTypesWriter } from "./writer/renderer/service-worker-types.js";
import { UtilityBindingsWriter } from "./writer/utility/utility-bindings.js";

/**
 * Throws if the file of a scope would overwrite another generated file. The files of the scopes
 * are named after them, so only the paths that the config sets, which are the ones of the utility
 * bindings and of the service worker preload script, can clash.
 */
function assertScopeFilesFree(config: t.IPCResolvedConfig, scopes: string[]): void {
   const configured: [string, string][] = [
      ["utilityBindingsPath", config.utilityBindingsFilePath],
      ["serviceWorkerPreloadPath", config.serviceWorkerPreloadFilePath],
   ];
   for (const scope of scopes) {
      for (const base of [config.preloadBindingsFilePath, config.rendererTypesFilePath]) {
         const file = scopedFilePath(base, scope);
         for (const [option, taken] of configured) {
            if (file === taken) {
               throw new Error(
                  `The config '${option}' ('${utils.toPosix(path.relative(config.projectRoot, file))}') ` +
                     `is the file that the scope '${scope}' is generated to. Choose a different path.`,
               );
            }
         }
      }
   }
}

/**
 * The writers of the output files, one entry per file. A writer of a file that exists only for
 * some schemas (utility processes, service workers) is listed only when the schema needs it.
 */
function collectWriters(config: t.IPCResolvedConfig, pfsArray: t.ParsedFileSpecs[]): BaseWriter[] {
   // The file for utility processes exists only for a schema that has channels to them.
   const utilityWriter = new UtilityBindingsWriter(config, pfsArray);
   // The files for service workers exist only for a schema that has channels to or from them.
   const workerWriters = [
      new ServiceWorkerPreloadWriter(config, pfsArray),
      new ServiceWorkerTypesWriter(config, pfsArray),
   ];
   // The files of a page hold the surface of one scope. The surface of no scope has the channels
   // that are open to all windows, and each scope adds its own channels to that.
   const scopes = collectScopes(pfsArray);
   assertScopeFilesFree(config, scopes);
   const pageSurfaces: [string | null, t.ParsedFileSpecs[]][] = [
      [null, scopes.length > 0 ? filterByScope(pfsArray, null) : pfsArray],
      ...scopes.map((scope): [string, t.ParsedFileSpecs[]] => [
         scope,
         filterByScope(pfsArray, scope),
      ]),
   ];
   return [
      new MainBindingsWriter(config, pfsArray),
      ...pageSurfaces.flatMap(([scope, surface]) => [
         new PreloadBindingsWriter(config, surface, scope),
         new RendererTypesWriter(config, surface, scope),
      ]),
      ...(utilityWriter.hasChannels() ? [utilityWriter] : []),
      ...workerWriters.filter((worker) => worker.hasChannels()),
   ];
}

/**
 * Resolves the config, parses and validates the schema, and renders every output file, without
 * writing anything. Returns `null` when the schema path does not exist.
 *
 * @param [options] - The options of the run, or the directory to find the project root from.
 */
export async function planRun(options?: t.RunOptions | string): Promise<t.RunPlan | null> {
   const config = await cfg.getResolvedConfig(options);
   if (!config.ipcSchema.stats) {
      return null;
   }
   const pfsArray: t.ParsedFileSpecs[] = [];
   for (const source of await loadSchemaSources(config)) {
      const specs = parseSpecs(source);
      if (specs.channelSpecArray.length > 0) {
         pfsArray.push({ fullPath: source.fullPath, relativePath: source.relativePath, specs });
      }
   }
   validateGlobalChannelSpecs(pfsArray);
   validateReservedApiNames(pfsArray, config);
   logger.cloneWarnings(
      pfsArray.flatMap((pfs) => getCloneWarnings(pfs.specs.channelSpecArray, pfs.relativePath)),
   );
   const outputs = collectWriters(config, pfsArray).map((writer) => writer.toOutputFile());
   return { config, pfsArray, outputs };
}

/**
 * Generates the IPC bindings of the project that contains `cwd`.
 *
 * @param [options] - The options of the run, or the directory to find the project root from as a
 * string. The project root is the directory of the nearest `package.json` at or above it, and the
 * directory defaults to the process working directory.
 */
export async function ipcAutomation(options?: t.RunOptions | string): Promise<void> {
   const plan = await planRun(options);
   if (plan === null) {
      const { ipcSchema } = await cfg.getResolvedConfig(options);
      await fsp.mkdir(path.dirname(ipcSchema.path), { recursive: true });
      logger.nonExistentSchemaPath(ipcSchema.path);
      return;
   }
   await writeOutputs(plan.outputs);
   if (plan.pfsArray.length === 0) {
      logger.noChannelExpressions(plan.config.ipcSchema.path);
   } else {
      logger.reportSuccess(plan.pfsArray, plan.config.projectRoot);
   }
}
