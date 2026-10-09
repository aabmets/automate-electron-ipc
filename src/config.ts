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

/** The extensions that a module specifier of a `.ts`, `.mts` or `.cts` file may end with. */
const SCRIPT_EXTENSIONS: Record<string, string[]> = {
   ".ts": [".ts"],
   ".mts": [".mts"],
   ".cts": [".cts"],
   ".js": [".ts"],
   ".mjs": [".mts"],
   ".cjs": [".cts"],
};

/** The TypeScript files which the path of the serializer module can mean. */
function serializerSourceFiles(serializerFilePath: string): string[] {
   const extension = path.posix.extname(serializerFilePath);
   const mapped = SCRIPT_EXTENSIONS[extension];
   if (mapped !== undefined) {
      const stem = serializerFilePath.slice(0, -extension.length);
      return mapped.map((ext) => `${stem}${ext}`);
   }
   const exts = [".ts", ".mts", ".cts"];
   return [
      ...exts.map((ext) => `${serializerFilePath}${ext}`),
      ...exts.map((ext) => `${serializerFilePath}/index${ext}`),
   ];
}

/**
 * Tells which input of the run the file of an output path is, or `null` if it is none: the
 * schema file, a schema source file in the schema directory, or the serializer module. The
 * run writes the output over the user's file, or parses the output as a schema on the next run.
 * `fold` maps a path to the form in which the file system compares it.
 */
function describeSourceFile(
   file: string,
   schemaFile: string,
   schemaDir: string | null,
   serializerFilePath: string | undefined,
   fold: (file: string) => string,
): string | null {
   if (fold(path.posix.normalize(file)) === fold(path.posix.normalize(schemaFile))) {
      return "the schema file";
   } else if (
      schemaDir !== null &&
      utils.isPathInside(fold(file), fold(schemaDir)) &&
      utils.isSchemaSourceFile(file)
   ) {
      return "a schema file";
   } else if (
      serializerFilePath !== undefined &&
      serializerSourceFiles(path.posix.normalize(serializerFilePath))
         .map(fold)
         .includes(fold(path.posix.normalize(file)))
   ) {
      return "the serializer module";
   }
   return null;
}

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
   const mainBindingsFilePath = path.join(ipcDataDir, "main.ts").replace(/\\/g, "/");
   const preloadBindingsFilePath = path.join(ipcDataDir, "preload.ts").replace(/\\/g, "/");
   const rendererTypesFilePath = path.join(ipcDataDir, "window.d.ts").replace(/\\/g, "/");
   const utilityBindingsFilePath = (
      mergedConfig.utilityBindingsPath === undefined
         ? path.join(ipcDataDir, "utility.ts")
         : utils.resolveUserProjectPath(mergedConfig.utilityBindingsPath, cwd)
   ).replace(/\\/g, "/");
   const serviceWorkerPreloadFilePath = (
      mergedConfig.serviceWorkerPreloadPath === undefined
         ? path.join(ipcDataDir, "service-worker-preload.ts")
         : utils.resolveUserProjectPath(mergedConfig.serviceWorkerPreloadPath, cwd)
   ).replace(/\\/g, "/");
   // The typings of the worker are written next to its preload script.
   const serviceWorkerTypesFilePath = path
      .join(path.dirname(serviceWorkerPreloadFilePath), "service-worker.d.ts")
      .replace(/\\/g, "/");
   const serializerFilePath = mergedConfig.serializer?.startsWith(".")
      ? utils.resolveUserProjectPath(mergedConfig.serializer, cwd)
      : undefined;
   const schemaPath = (onlySchemaDir ? schemaDir : schemaFile).replace(/\\/g, "/");
   const outputs: [string, string | undefined, string][] = [
      ["utilityBindingsPath", mergedConfig.utilityBindingsPath, utilityBindingsFilePath],
      [
         "serviceWorkerPreloadPath",
         mergedConfig.serviceWorkerPreloadPath,
         serviceWorkerPreloadFilePath,
      ],
   ];
   // A file system that ignores case holds `ipc/Main.ts` and `ipc/main.ts` in one file.
   const fold = (await utils.isCaseInsensitiveFileSystem(ipcDataDir))
      ? (file: string) => file.toLowerCase()
      : (file: string) => file;
   const taken = [mainBindingsFilePath, preloadBindingsFilePath, rendererTypesFilePath].map(fold);
   for (const [option, value, file] of outputs) {
      if (taken.includes(fold(file))) {
         throw new Error(
            `The config '${option}' ('${value}') is the path of another generated file. ` +
               "Choose a different path.",
         );
      }
      const source = describeSourceFile(
         file,
         schemaFile,
         onlySchemaDir ? schemaDir : null,
         serializerFilePath,
         fold,
      );
      if (source !== null) {
         throw new Error(
            `The config '${option}' ('${value}') is ${source}, which the run would overwrite. ` +
               "Choose a different path.",
         );
      }
      taken.push(fold(file));
   }
   return {
      ...mergedConfig,
      projectRoot,
      mainBindingsFilePath,
      preloadBindingsFilePath,
      rendererTypesFilePath,
      utilityBindingsFilePath,
      serviceWorkerPreloadFilePath,
      serviceWorkerTypesFilePath,
      ...(serializerFilePath === undefined ? {} : { serializerFilePath }),
      ipcSchema: {
         path: schemaPath,
         stats: onlySchemaDir ? schemaDirStats : schemaFileStats,
      },
   } as t.IPCResolvedConfig;
}

export default { getConfigFromUserPackage, getResolvedConfig };
