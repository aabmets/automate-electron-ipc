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
import writer from "./writer.js";

export function ipcAutomation(config?: t.IPCOptionalConfig): Plugin {
   return {
      name: "vite-plugin-automate-electron-ipc",
      buildStart: async () => {
         const finalConfig = valid.validateResolveConfig(config);
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
            const specs = parser.parseSpecs(contents.toString());
            if (specs.channelSpecArray.length > 0) {
               collectedSpecs.push({
                  fullPath: finalConfig.ipcSpecPath,
                  relativePath: config?.ipcSpecPath || "src/ipc-spec.ts",
                  parsedSpecs: specs,
               });
            }
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
               const specs = parser.parseSpecs(item.contents);
               if (specs.channelSpecArray.length > 0) {
                  collectedSpecs.push({
                     fullPath: item.fullPath,
                     relativePath: item.relativePath,
                     parsedSpecs: specs,
                  });
               }
            }
         }
         if (collectedSpecs.length === 0) {
            console.warn(
               "\n ⚠️ - Skipping IPC automation, because no Channel definitions",
               `were found at ipcSpecPath:\n      '${finalConfig.ipcSpecPath}'\n`,
            );
            return;
         }
         try {
            await Promise.all([
               writer.writeMainBindings(config, collectedSpecs),
               writer.writePreloadBindings(config, collectedSpecs),
               writer.writeRendererTypes(config, collectedSpecs),
            ]);
         } catch {
            // TODO: undo file changes
         }
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
