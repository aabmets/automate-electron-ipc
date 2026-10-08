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
import utils from "./utils.js";
import vld from "./validators.js";
import writer from "./writer/index.js";

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
   await Promise.all([
      new writer.MainBindingsWriter(config, pfsArray).write(),
      new writer.PreloadBindingsWriter(config, pfsArray).write(),
      new writer.RendererTypesWriter(config, pfsArray).write(),
   ]);
   if (pfsArray.length === 0) {
      logger.noChannelExpressions(config.ipcSchema.path);
   } else {
      logger.reportSuccess(pfsArray, config.projectRoot);
   }
}
