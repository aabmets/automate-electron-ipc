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
import type { Plugin } from "vite";
import parser from "./parser.js";
import utils from "./utils.js";
import valid from "./validators.js";
import writer from "./writer/index.js";

export function ipcAutomation(config?: t.IPCOptionalConfig): Plugin {
   return {
      name: "vite-plugin-automate-electron-ipc",
      buildStart: async () => {
         const resolvedConfig = valid.validateResolveConfig(config);
         const stat = await fsp.stat(resolvedConfig.ipcSpecPath).catch(() => null);
         const pfsArray: t.ParsedFileSpecs[] = [];

         if (!stat) {
            console.warn(
               "\n ⚠️ - Skipping IPC automation, because the path pointed to by",
               `ipcSpecPath does not exist:\n      '${resolvedConfig.ipcSpecPath}'\n`,
            );
            return;
         } else if (stat.isFile()) {
            const contents = await fsp.readFile(resolvedConfig.ipcSpecPath);
            const fileData: t.FileMeta = {
               fullPath: resolvedConfig.ipcSpecPath,
               relativePath: config?.ipcSpecPath || "src/ipc-spec.ts",
            };
            const specs = parser.parseSpecs({
               contents: contents.toString(),
               ...fileData,
            });
            if (specs.channelSpecArray.length > 0) {
               pfsArray.push({ specs: specs, ...fileData });
            }
         } else if (stat.isDirectory()) {
            const files = await fsp.readdir(resolvedConfig.ipcSpecPath, { recursive: true });
            const rawFileContents: t.RawFileContents[] = [];
            await Promise.all(
               files.map(async (file) => {
                  const fullPath = path.join(resolvedConfig.ipcSpecPath, file);
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
         if (pfsArray.length === 0) {
            console.warn(
               "\n ⚠️ - Skipping IPC automation, because no Channel definitions",
               `were found at ipcSpecPath:\n      '${resolvedConfig.ipcSpecPath}'\n`,
            );
            return;
         }
         await Promise.all([
            new writer.MainBindingsWriter(resolvedConfig, pfsArray).write(),
            new writer.PreloadBindingsWriter(resolvedConfig, pfsArray).write(),
            new writer.RendererTypesWriter(resolvedConfig, pfsArray).write(),
         ]);
      },
   };
}

export const ipcPreload = {
   filePath: utils.searchUpwards("user-data/preload.js"),
};

export function Channel(): t.Channels {
   const warning = () => {
      if (!(global as any)?.warnedIncorrectUsageOnce) {
         console.warn(
            "IPC automation Channel expressions have no effect when executed by JavaScript.",
         );
         (global as any).warnedIncorrectUsageOnce = true;
      }
   };
   return {
      Unicast: {
         RendererToMain: warning,
         RendererToRenderer: warning,
      },
      Broadcast: {
         RendererToMain: warning,
         MainToRenderer: warning,
      },
   };
}

export const type = null;
