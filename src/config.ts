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
import utils from "./utils.js";
import valid from "./validators.js";

export async function getConfigFromUserPackage(): Promise<t.IPCOptionalConfig> {
   const filePath = utils.resolveUserProjectPath("package.json");
   const fileContents = await fsp.readFile(filePath);
   const data = JSON.parse(fileContents.toString());
   return data?.config?.autoipc || {};
}

export async function getResolvedConfig(): Promise<t.IPCResolvedConfig> {
   const userConfig = await getConfigFromUserPackage();
   const mergedConfig: t.IPCOptionalConfig = {
      projectUsesNodeNext: false,
      ipcDataDir: "src/autoipc",
      codeIndent: 3,
      ...userConfig,
   };
   valid.validateOptionalConfig(mergedConfig);

   const ipcDataDir = utils.resolveUserProjectPath(mergedConfig.ipcDataDir);
   const schemaDir = path.join(ipcDataDir, "schema");
   const schemaFile = path.join(ipcDataDir, "schema.ts");
   const [schemaDirStats, schemaFileStats] = await Promise.all([
      fsp.stat(schemaDir).catch(() => null),
      fsp.stat(schemaFile).catch(() => null),
   ]);
   const onlySchemaDir = schemaDirStats && !schemaFileStats;
   return {
      ...mergedConfig,
      mainBindingsFilePath: path.join(ipcDataDir, "main.ts").replace(/\\/g, "/"),
      preloadBindingsFilePath: path.join(ipcDataDir, "preload.ts").replace(/\\/g, "/"),
      rendererTypesFilePath: path.join(ipcDataDir, "window.d.ts").replace(/\\/g, "/"),
      ipcSchema: {
         path: (onlySchemaDir ? schemaDir : schemaFile).replace(/\\/g, "/"),
         stats: onlySchemaDir ? schemaDirStats : schemaFileStats,
      },
   } as t.IPCResolvedConfig;
}

export default { getConfigFromUserPackage, getResolvedConfig };
