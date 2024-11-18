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

import path from "node:path";
import * as t from "@types";
import { assert, number, object, refine, string } from "superstruct";
import utils from "./utils.js";

/**
 * Merges any optional config object with default config, then
 * validates the merged IPC automation config. Returns the final
 * config with all paths resolved to absolute paths.
 *
 * - Validates:
 *   - `ipcSpecPath` and `rendererDir` must:
 *     - be relative paths to project root
 *     - not be identical to each other
 *     - must not reside within each other
 *   - `codeIndent` must be between 2 and 4, inclusive.
 *
 * @param config - Optional configuration object.
 * @returns The validated and resolved configuration.
 */
export function validateResolveConfig(config: t.IPCOptionalConfig = {}): t.IPCAssuredConfig {
   const mergedConfig: t.IPCAssuredConfig = {
      ipcSpecPath: "src/ipc-spec.ts",
      rendererDir: "src/renderer",
      codeIndent: 3,
      ...config,
   };
   const IPCAssuredConfigStruct = object({
      ipcSpecPath: refine(string(), "relative", (value) => {
         if (path.isAbsolute(value)) {
            return "ipcSpecPath must be relative to the project root";
         } else if (value === mergedConfig.rendererDir) {
            return "ipcSpecPath and rendererDir cannot be identical";
         } else if (utils.isPathInside(value, mergedConfig.rendererDir)) {
            return "ipcSpecPath cannot be relative to rendererDir";
         } else {
            return true;
         }
      }),
      rendererDir: refine(string(), "relative", (value) => {
         if (path.isAbsolute(value)) {
            return "rendererDir must be relative to the project root";
         } else if (utils.isPathInside(value, mergedConfig.ipcSpecPath)) {
            return "rendererDir cannot be relative to ipcSpecPath";
         } else {
            return true;
         }
      }),
      codeIndent: refine(number(), "clamped", (value) => {
         const errMsg = "value cannot be less than 2 or greater than 4";
         return value >= 2 && value <= 4 ? true : errMsg;
      }),
   });
   assert(mergedConfig, IPCAssuredConfigStruct);
   return Object.assign(mergedConfig, {
      ipcSpecPath: utils.resolveUserProjectPath(mergedConfig.ipcSpecPath),
      rendererDir: utils.resolveUserProjectPath(mergedConfig.rendererDir),
   });
}

export default { validateResolveConfig };
