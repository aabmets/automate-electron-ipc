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
import { assertOutputsDistinct, deriveOutputPaths } from "./config-outputs.js";
import utils from "./utils.js";
import { validateOptionalConfig } from "./validation/config-validation.js";

/** Names the kind of a JSON value for an error message. */
function describeJsonValue(value: unknown): string {
   if (value === null) {
      return "null";
   }
   return Array.isArray(value) ? "an array" : `of type ${typeof value}`;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
   return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getConfigFromUserPackage(cwd?: string): Promise<t.IPCOptionalConfig> {
   const filePath = utils.resolveUserProjectPath("package.json", cwd);
   const fileContents = await fsp.readFile(filePath);
   let data: unknown;
   try {
      data = JSON.parse(fileContents.toString());
   } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot parse '${filePath}': it is not valid JSON. ${reason}`);
   }
   if (!isJsonObject(data)) {
      throw new Error(
         `Cannot read '${filePath}': the manifest must hold a JSON object, ` +
            `but it holds ${describeJsonValue(data)}.`,
      );
   }
   if (data.config === undefined) {
      return {};
   }
   if (!isJsonObject(data.config)) {
      throw new Error(
         `Cannot read '${filePath}': 'config' must be an object, ` +
            `but it is ${describeJsonValue(data.config)}.`,
      );
   }
   if (data.config.autoipc === undefined) {
      return {};
   }
   if (!isJsonObject(data.config.autoipc)) {
      throw new Error(
         `Cannot read '${filePath}': 'config.autoipc' must be an object, ` +
            `but it is ${describeJsonValue(data.config.autoipc)}.`,
      );
   }
   return data.config.autoipc as t.IPCOptionalConfig;
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
      timeoutMs: 0,
      exposeAs: "ipc",
      autoExpose: true,
      getPathForFile: false,
      ...userConfig,
   };
   validateOptionalConfig(mergedConfig);

   const projectRoot = utils.resolveUserProjectPath("", cwd);
   const ipcDataDir = utils.resolveUserProjectPath(mergedConfig.ipcDataDir, cwd);
   const schemaDir = path.join(ipcDataDir, "schema");
   const schemaFile = path.join(ipcDataDir, "schema.ts");
   const [schemaDirStats, schemaFileStats] = await Promise.all([
      fsp.stat(schemaDir).catch(() => null),
      fsp.stat(schemaFile).catch(() => null),
   ]);
   const onlySchemaDir = schemaDirStats && !schemaFileStats;
   const outputs = deriveOutputPaths(mergedConfig, ipcDataDir, cwd);
   const serializerFilePath = mergedConfig.serializer?.startsWith(".")
      ? utils.resolveUserProjectPath(mergedConfig.serializer, cwd)
      : undefined;
   const schemaPath = utils.toPosix(onlySchemaDir ? schemaDir : schemaFile);
   await assertOutputsDistinct(mergedConfig, outputs, {
      ipcDataDir,
      schemaFile,
      schemaDir: onlySchemaDir ? schemaDir : null,
      serializerFilePath,
   });
   return {
      ...mergedConfig,
      projectRoot,
      ...outputs,
      ...(serializerFilePath === undefined ? {} : { serializerFilePath }),
      ipcSchema: {
         path: schemaPath,
         stats: onlySchemaDir ? schemaDirStats : schemaFileStats,
      },
   } as t.IPCResolvedConfig;
}

export default { getConfigFromUserPackage, getResolvedConfig };
