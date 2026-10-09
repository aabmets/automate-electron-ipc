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

import path from "node:path";
import type * as t from "@types";
import { assert, boolean, number, object, optional, refine, string } from "superstruct";
import utils from "../utils.js";
import { isReservedGlobalName } from "./reserved-globals.js";

/** A path in the project, relative to its root, of a TypeScript file. */
function relativeScriptPath(option: string) {
   return refine(string(), "relative", (value) => {
      if (path.isAbsolute(value)) {
         return `${option} must be relative to the project root`;
      }
      return utils.isSchemaSourceFile(value) ? true : `${option} must be the path of a .ts file`;
   });
}

export function validateOptionalConfig(config: t.IPCOptionalConfig): void {
   const IPCOptionalConfigStruct = object({
      projectUsesNodeNext: boolean(),
      ipcDataDir: refine(string(), "relative", (value) => {
         const errMsg = "ipcDataDir must be relative to the project root";
         return path.isAbsolute(value) ? errMsg : true;
      }),
      rawErrors: optional(boolean()),
      utilityBindingsPath: optional(relativeScriptPath("utilityBindingsPath")),
      serviceWorkerPreloadPath: optional(relativeScriptPath("serviceWorkerPreloadPath")),
      channelPrefix: optional(
         refine(string(), "prefix", (value) => {
            if (value.length > 64) {
               return "channelPrefix cannot be longer than 64 characters";
            }
            return /^[\w.:/@#-]*$/.test(value)
               ? true
               : "channelPrefix can contain only letters, digits and _ . : / @ # -";
         }),
      ),
      timeoutMs: optional(
         refine(number(), "timeout", (value) =>
            Number.isSafeInteger(value) && value >= 0
               ? true
               : "timeoutMs must be a non-negative integer",
         ),
      ),
      exposeAs: optional(
         refine(string(), "identifier", (value) => {
            if (!/^[A-Za-z_$][\w$]*$/.test(value)) {
               return "exposeAs must be an identifier: letters, digits, _ and $, not starting with a digit";
            }
            return isReservedGlobalName(value)
               ? `exposeAs '${value}' is a reserved word or a global of the page. Choose another name.`
               : true;
         }),
      ),
      isolatedWorldId: optional(
         refine(number(), "world", (value) =>
            Number.isInteger(value) && value >= 1000 && value <= 2 ** 31 - 1
               ? true
               : "isolatedWorldId must be an integer of 1000 or more, up to 2147483647",
         ),
      ),
      autoExpose: optional(boolean()),
      getPathForFile: optional(boolean()),
      serializer: optional(
         refine(string(), "module", (value) => {
            if (value.startsWith(".")) {
               return /^\.{1,2}\/[^\0\r\n]+$/.test(value)
                  ? true
                  : "serializer must start with ./ or ../ when it is a path in the project";
            }
            return /^(@[\w.-]+\/)?[\w.-]+(\/[\w.@-]+)*$/.test(value)
               ? true
               : "serializer must be a package name such as 'superjson', or a path that starts with ./ or ../";
         }),
      ),
      codeIndent: refine(number(), "clamped", (value) => {
         if (!Number.isInteger(value)) {
            return "value must be an integer";
         }
         const errMsg = "value cannot be less than 2 or greater than 4";
         return value >= 2 && value <= 4 ? true : errMsg;
      }),
   });
   assert(config, IPCOptionalConfigStruct);
}
