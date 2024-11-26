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
   assert,
   array,
   boolean,
   never,
   number,
   object,
   optional,
   refine,
   string,
} from "superstruct";
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
export function validateResolveConfig(config: t.IPCOptionalConfig = {}): t.IPCResolvedConfig {
   const mergedConfig: t.IPCResolvedConfig = {
      ipcSpecPath: "src/ipc-spec.ts",
      rendererDir: "src/renderer",
      codeIndent: 3,
      ...config,
   };
   const IPCResolvedConfigStruct = object({
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
   assert(mergedConfig, IPCResolvedConfigStruct);
   return Object.assign(mergedConfig, {
      ipcSpecPath: utils.resolveUserProjectPath(mergedConfig.ipcSpecPath),
      rendererDir: utils.resolveUserProjectPath(mergedConfig.rendererDir),
   });
}

export function validateChannelSpec(spec: Partial<t.ChannelSpec>): t.ChannelSpec {
   const ListenersStruct = refine(string(), "format", (value) => {
      if (value.length < 5) {
         const msg = "Channel listener names must be at least 5 characters in length";
         return `'${value}'\n${msg}\n`;
      } else if (!/^on[A-Z]\w+/.test(value)) {
         const msg =
            "Channel listener names must begin with " +
            "lowercase 'on', followed by a capital letter";
         return `'${value}'\n${msg}\n`;
      }
      return true;
   });
   const ChannelSpecStruct = object({
      name: refine(string(), "pascalcase", (value) => {
         if (value.length < 3) {
            return "Channel name must be at least 3 characters in length";
         } else if (value.toLowerCase().startsWith("on")) {
            return "Channel name must not begin with 'on'";
         } else if (/^(?![A-Z])/.test(value)) {
            return "Channel name must start with a capital letter";
         } else {
            return true;
         }
      }),
      kind: refine(string(), "choice", (value) => {
         const choices = ["Broadcast", "Unicast"];
         if (choices.includes(value)) {
            return true;
         } else {
            return `Channel kind must be one of '${choices}'`;
         }
      }),
      direction: refine(string(), "choice", (value) => {
         const choices = ["RendererToRenderer", "RendererToMain", "MainToRenderer"];
         if (choices.includes(value)) {
            return true;
         } else {
            return `Channel direction must be one of '${choices}'`;
         }
      }),
      signature: object({
         definition: string(),
         params: array(
            object({
               name: string(),
               type: string(),
               rest: boolean(),
               optional: boolean(),
            }),
         ),
         returnType: string(),
         customTypes: array(string()),
         async: boolean(),
      }),
      listeners:
         spec?.kind === ("Broadcast" as t.ChannelKind)
            ? optional(array(ListenersStruct))
            : optional(never()),
   });
   assert(spec, ChannelSpecStruct);
   return spec as t.ChannelSpec;
}

export default { validateResolveConfig, validateChannelSpec };
