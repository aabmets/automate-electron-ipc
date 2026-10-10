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

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { LRUCache } from "./cache.js";
import { isCaseInsensitiveFileSystem } from "./file-system.js";

/**
 * Recursively searches upwards from the provided module URL or directory
 * to find a specified path. Returns the full resolved path if found,
 * otherwise returns an empty string.
 *
 * @param forPath - The relative path to search for.
 * @param [startFrom=import.meta.url] - The file URL or filesystem path to start the search from.
 * @returns The full resolved path if found, or an empty string.
 */
export function searchUpwards(forPath: string, startFrom = import.meta.url): string {
   // The start path is part of the key, so that a different cwd never reuses the result of
   // another one. Misses are not cached, so that a file which appears later is still found.
   const key = `${forPath}\0${startFrom}`;
   const cache = LRUCache.getInstance("utils.searchUpwards");
   const [exists, value] = cache.get(key);
   if (exists) {
      return value as string;
   }
   const startPath = startFrom.startsWith("file://") ? url.fileURLToPath(startFrom) : startFrom;
   let currentDir = path.dirname(startPath);

   while (true) {
      const possiblePath = path.resolve(currentDir, forPath);
      if (fs.existsSync(possiblePath)) {
         cache.put(key, possiblePath);
         return possiblePath;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
         break;
      }
      currentDir = parentDir;
   }
   return "";
}

/**
 * Finds, resolves and returns the users project directory, which is the directory of the
 * nearest `package.json` at or above the working directory, optionally concatenating it
 * with a relative sub-path.
 *
 * @param [subPath=''] - Relative sub-path in the users project directory.
 * @param [cwd=process.cwd()] - Directory to start the search from. Relative paths are
 * resolved against the process working directory.
 * @returns Resolved sub-path in the users project directory.
 * @throws If no `package.json` exists in `cwd` or any of its parent directories.
 */
export function resolveUserProjectPath(subPath = "", cwd: string = process.cwd()): string {
   const startDir = path.resolve(cwd);
   // `searchUpwards` starts from the directory of the given file, so name a file in `startDir`.
   const manifest = searchUpwards("package.json", path.join(startDir, "package.json"));
   if (!manifest) {
      throw new Error(
         `Cannot find the project root: no package.json in '${startDir}' or any parent directory.`,
      );
   }
   return toPosix(path.join(path.dirname(manifest), subPath));
}

/**
 * Spells a path with `/` separators, as the generated files and the messages show it on every
 * platform.
 *
 * @param filePath - A path, which may use `\` as the separator.
 * @returns The same path with every `\` turned into `/`.
 */
export function toPosix(filePath: string): string {
   return filePath.replaceAll("\\", "/");
}

/**
 * Compares two strings by UTF-16 code units, so that the order is the same on every machine,
 * unlike `localeCompare`, which depends on the locale of the process.
 * Use it as the comparator of `Array.prototype.sort`.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns A negative number, zero or a positive number.
 */
export function compareStrings(a: string, b: string): number {
   if (a === b) {
      return 0;
   }
   return a < b ? -1 : 1;
}

/**
 * Compares two paths by their `/` spelling, so that the order of the files is the same on every
 * platform. Use it as the comparator of `Array.prototype.sort`.
 *
 * @param a - The first path.
 * @param b - The second path.
 * @returns A negative number, zero or a positive number.
 */
export function comparePaths(a: string, b: string): number {
   return compareStrings(toPosix(a), toPosix(b));
}

/**
 * Tells whether a file name in a schema directory is a schema source file:
 * a `.ts`, `.mts` or `.cts` file that is not a declaration file (`.d.ts`, `.d.mts`, `.d.cts`).
 *
 * @param fileName - File name or path to check.
 * @returns True if the file may contain channel declarations.
 */
export function isSchemaSourceFile(fileName: string): boolean {
   return /\.[mc]?ts$/.test(fileName) && !/\.d\.[mc]?ts$/.test(fileName);
}

/** Checks if a given path is inside another path. */
export function isPathInside(childPath: string, parentPath: string): boolean {
   const relative = path.relative(parentPath, childPath);
   return (
      Boolean(relative) &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      relative !== ""
   );
}

export default {
   searchUpwards,
   resolveUserProjectPath,
   toPosix,
   compareStrings,
   comparePaths,
   isSchemaSourceFile,
   isPathInside,
   isCaseInsensitiveFileSystem,
};
