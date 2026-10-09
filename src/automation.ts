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
import { parseSpecs } from "./parser/parser.js";
import { collectScopes, filterByScope, scopedFilePath } from "./scopes.js";
import utils from "./utils.js";
import { getCloneWarnings } from "./validation/clone-issues.js";
import {
   validateGlobalChannelSpecs,
   validateReservedApiNames,
} from "./validation/global-validation.js";
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
                  `The config '${option}' ('${path.relative(config.projectRoot, file).replaceAll("\\", "/")}') ` +
                     `is the file that the scope '${scope}' is generated to. Choose a different path.`,
               );
            }
         }
      }
   }
}

/**
 * Generates the IPC bindings of the project that contains `cwd`.
 *
 * @param [cwd=process.cwd()] - Directory to find the project root from, which is the directory
 * of the nearest `package.json` at or above it.
 */
export async function ipcAutomation(cwd?: string): Promise<void> {
   const config = await cfg.getResolvedConfig(cwd);
   const pfsArray: t.ParsedFileSpecs[] = [];

   if (!config.ipcSchema.stats) {
      await fsp.mkdir(path.dirname(config.ipcSchema.path), { recursive: true });
      logger.nonExistentSchemaPath(config.ipcSchema.path);
      return;
   } else if (config.ipcSchema.stats.isFile()) {
      const contents = await fsp.readFile(config.ipcSchema.path);
      const fileData: t.FileMeta = {
         fullPath: config.ipcSchema.path,
         // The data dir is the directory of the file, so the file is named with `schema.ts`.
         relativePath: path.posix.join(config.ipcDataDir.replaceAll("\\", "/"), "schema.ts"),
      };
      const specs = parseSpecs({
         contents: contents.toString(),
         ...fileData,
      });
      if (specs.channelSpecArray.length > 0) {
         pfsArray.push({ specs: specs, ...fileData });
      }
   } else if (config.ipcSchema.stats.isDirectory()) {
      const files = await fsp.readdir(config.ipcSchema.path, { recursive: true });
      // The order of `readdir` results and of read completions varies between runs, so files are
      // sorted by relative path and the results are collected in that order.
      const schemaFiles = files
         .filter(utils.isSchemaSourceFile)
         .sort((a, b) => utils.compareStrings(a.replaceAll("\\", "/"), b.replaceAll("\\", "/")));
      const rawFileContents = (
         await Promise.all(
            schemaFiles.map(async (file): Promise<t.RawFileContents | null> => {
               const fullPath = path.join(config.ipcSchema.path, file);
               const stat = await fsp.stat(fullPath);
               if (!stat.isFile()) {
                  return null;
               }
               const contents = await fsp.readFile(fullPath);
               return { fullPath, relativePath: file, contents: contents.toString() };
            }),
         )
      ).filter((item) => item !== null);
      for (const item of rawFileContents) {
         const specs = parseSpecs(item);
         if (specs.channelSpecArray.length > 0) {
            pfsArray.push({
               fullPath: item.fullPath,
               relativePath: item.relativePath,
               specs: specs,
            });
         }
      }
   }
   validateGlobalChannelSpecs(pfsArray);
   validateReservedApiNames(pfsArray, config);
   logger.cloneWarnings(
      pfsArray.flatMap((pfs) => getCloneWarnings(pfs.specs.channelSpecArray, pfs.relativePath)),
   );
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
   await Promise.all([
      new MainBindingsWriter(config, pfsArray).write(),
      ...pageSurfaces.flatMap(([scope, surface]) => [
         new PreloadBindingsWriter(config, surface, scope).write(),
         new RendererTypesWriter(config, surface, scope).write(),
      ]),
      ...(utilityWriter.hasChannels() ? [utilityWriter.write()] : []),
      ...workerWriters.filter((worker) => worker.hasChannels()).map((worker) => worker.write()),
   ]);
   if (pfsArray.length === 0) {
      logger.noChannelExpressions(config.ipcSchema.path);
   } else {
      logger.reportSuccess(pfsArray, config.projectRoot);
   }
}
