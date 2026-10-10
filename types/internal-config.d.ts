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

import type { Stats } from "node:fs";
import type { AutoIpcConfig } from "./config-file.js";

export type IPCOptionalConfig = AutoIpcConfig;

export interface IPCResolvedConfig {
   /** The directory of the nearest `package.json`, with `/` separators. */
   projectRoot: string;
   mainBindingsFilePath: string;
   preloadBindingsFilePath: string;
   rendererTypesFilePath: string;
   typesFilePath: string;
   mockFilePath: string;
   utilityBindingsFilePath: string;
   serviceWorkerPreloadFilePath: string;
   serviceWorkerTypesFilePath: string;
   hooksFilePath: string;
   projectUsesNodeNext: boolean;
   ipcDataDir: string;
   codeIndent: number;
   rawErrors: boolean;
   channelPrefix: string;
   timeoutMs: number;
   exposeAs: string;
   isolatedWorldId?: number;
   autoExpose: boolean;
   getPathForFile: boolean;
   mock: boolean;
   format: "biome" | "prettier" | false;
   hooks: "react" | "vue" | false;
   serializer?: string;
   /** The path of the `serializer` module with `/` separators, when the config gives a path. */
   serializerFilePath?: string;
   ipcSchema: {
      path: string;
      stats: Stats | null;
   };
}
