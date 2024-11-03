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

import type { IPCAutomationOption } from "@types";
import utils from "@utils";
import { assert, array, object, refine, string } from "superstruct";

/**
 * Resolves all paths in an array of IPCAutomationOption objects using the searchUpwards function
 * and checks that browserPreloadFile is not the same as rendererTypesFile and neither are inside
 * mainHandlersDir or its subdirectories. Additionally, checks that no path is shared between
 * any IPCAutomationOption objects.
 *
 * @param options - An array of IPCAutomationOption objects.
 */
export function validateOptions(options: IPCAutomationOption[]): void {
   const msg = utils.dedent(`
      IPC automation cannot work without valid configuration options.
      Please read the documentation on the correct usage of this plugin.
   `);
   const IPCAutomationOptionStruct = object({
      mainHandlersDir: string(),
      browserPreloadFile: string(),
      rendererTypesFile: string(),
   });
   const OptionsArray = refine(array(IPCAutomationOptionStruct), "OptionsArray", (value) => {
      return Array.isArray(value) && value.length > 0;
   });
   assert(options, OptionsArray, msg);

   const usedPaths = new Set<string>();

   for (const option of options) {
      const resolvedMainHandlersDir = utils.searchUpwards(option.mainHandlersDir);
      const resolvedBrowserPreloadFile = utils.searchUpwards(option.browserPreloadFile);
      const resolvedRendererTypesFile = utils.searchUpwards(option.rendererTypesFile);

      if (!resolvedMainHandlersDir) {
         throw new Error(`mainHandlersDir path not found: "${option.mainHandlersDir}"`);
      } else if (!resolvedBrowserPreloadFile) {
         throw new Error(`browserPreloadFile path not found: "${option.browserPreloadFile}"`);
      } else if (!resolvedRendererTypesFile) {
         throw new Error(`rendererTypesFile path not found: "${option.rendererTypesFile}"`);
      }
      option.mainHandlersDir = resolvedMainHandlersDir;
      option.browserPreloadFile = resolvedBrowserPreloadFile;
      option.rendererTypesFile = resolvedRendererTypesFile;

      if (option.browserPreloadFile === option.rendererTypesFile) {
         throw new Error(
            utils.dedent(`browserPreloadFile and rendererTypesFile cannot be the same file:
            "${option.browserPreloadFile}"`),
         );
      } else if (utils.isPathInside(option.browserPreloadFile, option.mainHandlersDir)) {
         throw new Error(
            utils.dedent(`browserPreloadFile (1) cannot be inside mainHandlersDir (2):
            (1) "${option.browserPreloadFile}"
            (2) "${option.mainHandlersDir}"`),
         );
      } else if (utils.isPathInside(option.rendererTypesFile, option.mainHandlersDir)) {
         throw new Error(
            utils.dedent(`rendererTypesFile (1) cannot be inside mainHandlersDir (2):
            (1) "${option.rendererTypesFile}"
            (2) "${option.mainHandlersDir}"`),
         );
      }

      const pathsToCheck = [
         option.mainHandlersDir,
         option.browserPreloadFile,
         option.rendererTypesFile,
      ];
      pathsToCheck.forEach((path) => {
         if (usedPaths.has(path)) {
            throw new Error(`Path is already used by another IPCAutomationOption:\n"${path}"`);
         }
         usedPaths.add(path);
      });
   }
}

export default { validateOptions };
