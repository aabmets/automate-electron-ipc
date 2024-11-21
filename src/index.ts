/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import fsp from "node:fs/promises";
import path from "node:path";
import * as t from "@types";
import type { Plugin } from "vite";
import parser from "./parser.js";
import utils from "./utils.js";
import vld from "./validators.js";

export function ipcAutomation(config?: t.IPCOptionalConfig): Plugin {
   return {
      name: "vite-plugin-automate-electron-ipc",
      buildStart: async () => {
         const finalConfig = vld.validateResolveConfig(config);
         const stat = await fsp.stat(finalConfig.ipcSpecPath).catch(() => null);
         const collectedSpecs: t.CollectedSpecs[] = [];

         if (!stat) {
            console.warn(
               "\n ⚠️ - Skipping IPC automation, because the path pointed to by",
               `ipcSpecPath does not exist:\n      '${finalConfig.ipcSpecPath}'\n`,
            );
            return;
         } else if (stat.isFile()) {
            const contents = await fsp.readFile(finalConfig.ipcSpecPath);
            collectedSpecs.push({
               fullPath: finalConfig.ipcSpecPath,
               relativePath: config?.ipcSpecPath || "src/ipc-spec.ts",
               parsedSpecs: parser.parseSpecs(contents.toString()),
            });
         } else if (stat.isDirectory()) {
            const files = await fsp.readdir(finalConfig.ipcSpecPath, { recursive: true });
            const collectedContents: t.CollectedContents[] = [];
            await Promise.all(
               files.map(async (file) => {
                  const fullPath = path.join(finalConfig.ipcSpecPath, file);
                  const stat = await fsp.stat(fullPath);
                  if (stat.isFile() && (await fsp.exists(fullPath))) {
                     const contents = await fsp.readFile(fullPath);
                     collectedContents.push({
                        fullPath,
                        relativePath: file,
                        contents: contents.toString(),
                     });
                  }
               }),
            );
            for (const item of collectedContents) {
               collectedSpecs.push({
                  fullPath: item.fullPath,
                  relativePath: item.relativePath,
                  parsedSpecs: parser.parseSpecs(item.contents),
               });
            }
         }
         for (const item of collectedSpecs) {
            console.debug(item);
         }
         const results: boolean[] = await Promise.all([
            (async () => true)(), // writeMainBindings(config, collectedFileSpecs),
            (async () => true)(), // writePreloadBindings(config, collectedFileSpecs),
            (async () => true)(), // writeRendererTypes(config, collectedFileSpecs),
         ]);
         if (results.includes(false)) {
            console.warn(
               "\n ⚠️ - Skipping IPC automation, because no Channel definitions",
               `were found at ipcSpecPath:\n      '${finalConfig.ipcSpecPath}'\n`,
            );
         }
      },
   };
}

export const ipcPreload = {
   filePath: utils.searchUpwards("user-data/preload.js"),
};

export function Channel(): void {
   throw new Error("IPC automation Channel functions cannot be executed by JavaScript.");
}

export const type = null;
