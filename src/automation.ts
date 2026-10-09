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
import parser from "./parser.js";
import scopeUtils from "./scopes.js";
import utils from "./utils.js";
import vld from "./validators.js";
import writer from "./writer/index.js";

/**
 * Throws if the file of a scope would overwrite another generated file. The files of the scopes
 * are named after them, so only the path of the utility bindings, which is configurable, can clash.
 */
function assertScopeFilesFree(config: t.IPCResolvedConfig, scopes: string[]): void {
   for (const scope of scopes) {
      for (const base of [config.preloadBindingsFilePath, config.rendererTypesFilePath]) {
         const file = scopeUtils.scopedFilePath(base, scope);
         if (file === config.utilityBindingsFilePath) {
            throw new Error(
               `The config 'utilityBindingsPath' ('${path.relative(config.projectRoot, file).replaceAll("\\", "/")}') ` +
                  `is the file that the scope '${scope}' is generated to. Choose a different path.`,
            );
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
         relativePath: config.ipcDataDir,
      };
      const specs = parser.parseSpecs({
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
         const specs = parser.parseSpecs(item);
         if (specs.channelSpecArray.length > 0) {
            pfsArray.push({
               fullPath: item.fullPath,
               relativePath: item.relativePath,
               specs: specs,
            });
         }
      }
   }
   vld.validateGlobalChannelSpecs(pfsArray);
   logger.cloneWarnings(
      pfsArray.flatMap((pfs) => vld.getCloneWarnings(pfs.specs.channelSpecArray, pfs.relativePath)),
   );
   // The file for utility processes exists only for a schema that has channels to them.
   const utilityWriter = new writer.UtilityBindingsWriter(config, pfsArray);
   // The files of a page hold the surface of one scope. The surface of no scope has the channels
   // that are open to all windows, and each scope adds its own channels to that.
   const scopes = scopeUtils.collectScopes(pfsArray);
   assertScopeFilesFree(config, scopes);
   const pageSurfaces: [string | null, t.ParsedFileSpecs[]][] = [
      [null, scopes.length > 0 ? scopeUtils.filterByScope(pfsArray, null) : pfsArray],
      ...scopes.map((scope): [string, t.ParsedFileSpecs[]] => [
         scope,
         scopeUtils.filterByScope(pfsArray, scope),
      ]),
   ];
   await Promise.all([
      new writer.MainBindingsWriter(config, pfsArray).write(),
      ...pageSurfaces.flatMap(([scope, surface]) => [
         new writer.PreloadBindingsWriter(config, surface, scope).write(),
         new writer.RendererTypesWriter(config, surface, scope).write(),
      ]),
      ...(utilityWriter.hasChannels() ? [utilityWriter.write()] : []),
   ]);
   if (pfsArray.length === 0) {
      logger.noChannelExpressions(config.ipcSchema.path);
   } else {
      logger.reportSuccess(pfsArray, config.projectRoot);
   }
}
