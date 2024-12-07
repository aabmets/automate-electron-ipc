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
import logger from "./logger.js";
import parser from "./parser.js";
import valid from "./validators.js";
import writer from "./writer/index.js";

export function ipcAutomation(): t.IpcAutomationPlugin {
   return {
      name: "vite-plugin-automate-electron-ipc",
      buildStart: async () => {
         const config = await valid.validateResolveConfig();
         const pfsArray: t.ParsedFileSpecs[] = [];

         if (!config.ipcSchema.stats) {
            logger.nonExistentSchemaPath(config.ipcSchema.path);
            return;
         } else if (config.ipcSchema.stats.isFile()) {
            const contents = await fsp.readFile(config.ipcSchema.path);
            const fileData: t.FileMeta = {
               fullPath: config.ipcSchema.path,
               relativePath: config?.ipcDataDir || "src/ipc",
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
            const rawFileContents: t.RawFileContents[] = [];
            await Promise.all(
               files.map(async (file) => {
                  const fullPath = path.join(config.ipcSchema.path, file);
                  const stat = await fsp.stat(fullPath);
                  if (stat.isFile() && (await fsp.exists(fullPath))) {
                     const contents = await fsp.readFile(fullPath);
                     rawFileContents.push({
                        fullPath,
                        relativePath: file,
                        contents: contents.toString(),
                     });
                  }
               }),
            );
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
         await Promise.all([
            new writer.MainBindingsWriter(config, pfsArray).write(),
            new writer.PreloadBindingsWriter(config, pfsArray).write(),
            new writer.RendererTypesWriter(config, pfsArray).write(),
         ]);
         if (pfsArray.length === 0) {
            logger.noChannelExpressions(config.ipcSchema.path);
         } else {
            logger.reportSuccess(pfsArray);
         }
      },
   };
}

export function Channel(): t.Channels {
   return {
      RendererToMain: {
         Unicast: logger.cannotExecuteChannels,
         Broadcast: logger.cannotExecuteChannels,
      },
      MainToRenderer: {
         Broadcast: logger.cannotExecuteChannels,
      },
      RendererToRenderer: {
         Port: logger.cannotExecuteChannels,
      },
   };
}

export const type = null;
