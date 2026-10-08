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

export async function getConfigFromUserPackage(cwd?: string): Promise<t.IPCOptionalConfig> {
   const filePath = utils.resolveUserProjectPath("package.json", cwd);
   const fileContents = await fsp.readFile(filePath);
   const data = JSON.parse(fileContents.toString());
   return data?.config?.autoipc || {};
}

/**
 * Reads the config of the project that contains `cwd`, which is the directory of the nearest
 * `package.json` at or above it. Defaults to the process working directory.
 */
export async function getResolvedConfig(cwd?: string): Promise<t.IPCResolvedConfig> {
   const userConfig = await getConfigFromUserPackage(cwd);
   const mergedConfig: t.IPCOptionalConfig = {
      projectUsesNodeNext: false,
      ipcDataDir: "src/autoipc",
      codeIndent: 3,
      rawErrors: false,
      channelPrefix: "autoipc:",
      ...userConfig,
   };
   valid.validateOptionalConfig(mergedConfig);

   const projectRoot = utils.resolveUserProjectPath("", cwd);
   const ipcDataDir = utils.resolveUserProjectPath(mergedConfig.ipcDataDir, cwd);
   const schemaDir = path.join(ipcDataDir, "schema");
   const schemaFile = path.join(ipcDataDir, "schema.ts");
   const [schemaDirStats, schemaFileStats] = await Promise.all([
      fsp.stat(schemaDir).catch(() => null),
      fsp.stat(schemaFile).catch(() => null),
   ]);
   const onlySchemaDir = schemaDirStats && !schemaFileStats;
   return {
      ...mergedConfig,
      projectRoot,
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
