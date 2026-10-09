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
import utils from "./utils.js";

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

/** The paths of the files that a run writes, with `/` separators. */
export interface OutputPaths {
   mainBindingsFilePath: string;
   preloadBindingsFilePath: string;
   rendererTypesFilePath: string;
   utilityBindingsFilePath: string;
   serviceWorkerPreloadFilePath: string;
   serviceWorkerTypesFilePath: string;
}

/**
 * Derives the paths of the generated files: the ones in the data directory, and the ones that the
 * config moves elsewhere (`utilityBindingsPath` and `serviceWorkerPreloadPath`).
 */
export function deriveOutputPaths(
   config: t.IPCOptionalConfig,
   ipcDataDir: string,
   cwd?: string,
): OutputPaths {
   const utilityBindingsFilePath = utils.toPosix(
      config.utilityBindingsPath === undefined
         ? path.join(ipcDataDir, "utility.ts")
         : utils.resolveUserProjectPath(config.utilityBindingsPath, cwd),
   );
   const serviceWorkerPreloadFilePath = utils.toPosix(
      config.serviceWorkerPreloadPath === undefined
         ? path.join(ipcDataDir, "service-worker-preload.ts")
         : utils.resolveUserProjectPath(config.serviceWorkerPreloadPath, cwd),
   );
   return {
      mainBindingsFilePath: utils.toPosix(path.join(ipcDataDir, "main.ts")),
      preloadBindingsFilePath: utils.toPosix(path.join(ipcDataDir, "preload.ts")),
      rendererTypesFilePath: utils.toPosix(path.join(ipcDataDir, "window.d.ts")),
      utilityBindingsFilePath,
      serviceWorkerPreloadFilePath,
      // The typings of the worker are written next to its preload script.
      serviceWorkerTypesFilePath: utils.toPosix(
         path.join(path.dirname(serviceWorkerPreloadFilePath), "service-worker.d.ts"),
      ),
   };
}

/** The inputs of the run that an output file must not overwrite. */
export interface OutputInputs {
   ipcDataDir: string;
   schemaFile: string;
   /** The schema directory, or `null` when the run does not read it. */
   schemaDir: string | null;
   serializerFilePath: string | undefined;
}

/**
 * Throws if a path that the config sets for an output is the path of another generated file, or
 * of an input of the run, which the run would overwrite.
 */
export async function assertOutputsDistinct(
   config: t.IPCOptionalConfig,
   outputs: OutputPaths,
   inputs: OutputInputs,
): Promise<void> {
   const configured: [string, string | undefined, string][] = [
      ["utilityBindingsPath", config.utilityBindingsPath, outputs.utilityBindingsFilePath],
      [
         "serviceWorkerPreloadPath",
         config.serviceWorkerPreloadPath,
         outputs.serviceWorkerPreloadFilePath,
      ],
   ];
   // A file system that ignores case holds `ipc/Main.ts` and `ipc/main.ts` in one file.
   const fold = (await utils.isCaseInsensitiveFileSystem(inputs.ipcDataDir))
      ? (file: string) => file.toLowerCase()
      : (file: string) => file;
   const taken = [
      outputs.mainBindingsFilePath,
      outputs.preloadBindingsFilePath,
      outputs.rendererTypesFilePath,
   ].map(fold);
   for (const [option, value, file] of configured) {
      if (taken.includes(fold(file))) {
         throw new Error(
            `The config '${option}' ('${value}') is the path of another generated file. ` +
               "Choose a different path.",
         );
      }
      const source = describeSourceFile(
         file,
         inputs.schemaFile,
         inputs.schemaDir,
         inputs.serializerFilePath,
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
}
