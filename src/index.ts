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
import ipc from "@src/ipc";
import parser from "@src/parser";
import validators from "@src/validators";
import type {
   CollectedSpecs,
   IPCAssuredConfig,
   IPCAutomationOption,
   IPCOptionalConfig,
} from "@types";
import type { Plugin } from "vite";

async function optionProcessor(
   option: IPCAutomationOption,
   config: IPCAssuredConfig,
): Promise<void> {
   const files = await fsp.readdir(option.mainHandlersDir, { recursive: true });
   const collection: CollectedSpecs[] = [];
   for (const file of files) {
      if (file.startsWith("index.ts")) {
         continue;
      }
      const fullPath = path.join(option.mainHandlersDir, file);
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (stat?.isFile()) {
         const contents = (await fsp.readFile(fullPath)).toString();
         const specs = parser.parseSpecs(contents);
         collection.push({
            fullPath,
            relativePath: file,
            parsedSpecs: specs,
         });
      }
   }
   await Promise.all([
      ipc.writeMainBindings(option, config, collection),
      ipc.writePreloadBindings(option, config, collection),
      ipc.writeRendererTypes(option, config, collection),
   ]);
}

export function ipcAutomation(
   options: IPCAutomationOption[],
   config: IPCOptionalConfig = {},
): Plugin {
   const assuredConfig: IPCAssuredConfig = {
      codeIndent: 4,
      channelIdentifierLength: 16,
      namespaceLength: 8,
      ...config,
   };
   validators.validateOptions(options);
   validators.validateConfig(assuredConfig);
   return {
      name: "automate-electron-ipc",
      buildStart: async () => {
         const promises: Promise<void>[] = [];
         options.forEach((option) => {
            promises.push(optionProcessor(option, assuredConfig));
         });
         await Promise.all(promises);
      },
   };
}
