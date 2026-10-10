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
import {
   any,
   assert,
   boolean,
   number,
   object,
   optional,
   refine,
   StructError,
   string,
} from "superstruct";
import { MANIFEST_SOURCE } from "../config-file.js";
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

/** A path in the project, relative to its root, of a `.ts` file that is not a declaration file. */
function relativeTsPath(option: string) {
   return refine(string(), "relative", (value) => {
      if (path.isAbsolute(value)) {
         return `${option} must be relative to the project root`;
      }
      return /\.ts$/.test(value) && utils.isSchemaSourceFile(value)
         ? true
         : `${option} must be the path of a .ts file`;
   });
}

/** A path in the project, relative to its root, of a `.d.ts` file. */
function relativeDeclarationPath(option: string) {
   return refine(string(), "relative", (value) => {
      if (path.isAbsolute(value)) {
         return `${option} must be relative to the project root`;
      }
      return /\.d\.ts$/.test(value) ? true : `${option} must be the path of a .d.ts file`;
   });
}

const IPCOptionalConfigStruct = object({
   projectUsesNodeNext: boolean(),
   ipcDataDir: refine(string(), "relative", (value) => {
      const errMsg = "ipcDataDir must be relative to the project root";
      return path.isAbsolute(value) ? errMsg : true;
   }),
   rawErrors: optional(boolean()),
   mainBindingsPath: optional(relativeTsPath("mainBindingsPath")),
   preloadBindingsPath: optional(relativeTsPath("preloadBindingsPath")),
   rendererTypesPath: optional(relativeDeclarationPath("rendererTypesPath")),
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
   format: optional(
      refine(any(), "formatter", (value) =>
         value === "biome" || value === "prettier" || value === false
            ? true
            : "format must be 'biome', 'prettier' or false",
      ),
   ),
   hooks: optional(
      refine(any(), "framework", (value) =>
         value === "react" || value === "vue" || value === false
            ? true
            : "hooks must be 'react', 'vue' or false",
      ),
   ),
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

/** The names of the options that the config knows, in sorted order. */
const KNOWN_KEYS = Object.keys(IPCOptionalConfigStruct.schema).sort(utils.compareStrings);

/**
 * Throws if the config is not valid. The messages name the source of the config, so that the user
 * knows where to fix it: unknown keys are named with the keys that exist.
 *
 * @param config - The config, with the defaults merged in.
 * @param [source] - Where the config comes from: a config file, or the manifest by default.
 * @param [overrideKeys] - The keys that the run options set. They are named as the source of an
 * error in place of `source`.
 */
export function validateOptionalConfig(
   config: t.IPCOptionalConfig,
   source = MANIFEST_SOURCE,
   overrideKeys: string[] = [],
): void {
   try {
      assert(config, IPCOptionalConfigStruct);
   } catch (error) {
      if (!(error instanceof StructError)) {
         throw error;
      }
      const [key] = error.path;
      const where = overrideKeys.includes(String(key)) ? "the run options" : source;
      if (error.type === "never" && error.path.length === 1) {
         throw new Error(
            `Unknown config key '${String(key)}' in ${where}. Known keys: ${KNOWN_KEYS.join(", ")}.`,
            { cause: error },
         );
      }
      throw new Error(`Invalid config in ${where}: ${error.message}`, { cause: error });
   }
}
