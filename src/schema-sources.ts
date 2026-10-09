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

/**
 * Reads the schema files of a run: the schema file, or every schema source file in the schema
 * directory. The directory is listed in an order that does not depend on the platform, and the
 * contents are returned in that order, whatever the order in which the reads finish. A run whose
 * schema path is neither a file nor a directory has no sources.
 *
 * @param config - The resolved config, whose `ipcSchema` names the schema path and its stats.
 * @returns The schema files, with their contents.
 */
export async function loadSchemaSources(config: t.IPCResolvedConfig): Promise<t.RawFileContents[]> {
   const { path: schemaPath, stats } = config.ipcSchema;
   if (stats?.isFile()) {
      const contents = await fsp.readFile(schemaPath);
      return [
         {
            fullPath: schemaPath,
            // The data dir is the directory of the file, so the file is named with `schema.ts`.
            relativePath: path.posix.join(utils.toPosix(config.ipcDataDir), "schema.ts"),
            contents: contents.toString(),
         },
      ];
   }
   if (!stats?.isDirectory()) {
      return [];
   }
   const files = await fsp.readdir(schemaPath, { recursive: true });
   // The order of `readdir` results and of read completions varies between runs, so files are
   // sorted by relative path and the results are collected in that order.
   const schemaFiles = files.filter(utils.isSchemaSourceFile).sort(utils.comparePaths);
   const sources = await Promise.all(
      schemaFiles.map(async (file): Promise<t.RawFileContents | null> => {
         const fullPath = path.join(schemaPath, file);
         if (!(await fsp.stat(fullPath)).isFile()) {
            return null;
         }
         const contents = await fsp.readFile(fullPath);
         return { fullPath, relativePath: file, contents: contents.toString() };
      }),
   );
   return sources.filter((item) => item !== null);
}
