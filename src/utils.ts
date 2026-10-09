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
import fsp from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { LRUCache } from "./cache.js";

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
   return path.join(path.dirname(manifest), subPath).replaceAll("\\", "/");
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
 * Tells whether a file name in a schema directory is a schema source file:
 * a `.ts`, `.mts` or `.cts` file that is not a declaration file (`.d.ts`, `.d.mts`, `.d.cts`).
 *
 * @param fileName - File name or path to check.
 * @returns True if the file may contain channel declarations.
 */
export function isSchemaSourceFile(fileName: string): boolean {
   return /\.[mc]?ts$/.test(fileName) && !/\.d\.[mc]?ts$/.test(fileName);
}

/**
 * Concatenates an array of regular expressions into a single regular expression.
 *
 * @param parts - An array of smaller regex patterns to be concatenated.
 * @param [flags=''] - Optional flags (e.g., 'g', 'i') to apply to the final concatenated regex.
 * @returns A new regular expression composed of the concatenated patterns.
 */
export function concatRegex(parts: RegExp[], flags = ""): RegExp {
   const pattern = parts.map((part) => part.source).join("");
   return new RegExp(pattern, flags);
}

/**
 * Checks if a given path is inside another path.
 *
 * @param childPath - The path to check.
 * @param parentPath - The parent path.
 * @returns True if childPath is inside parentPath, false otherwise.
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
   const relative = path.relative(parentPath, childPath);
   return (
      Boolean(relative) &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      relative !== ""
   );
}

/**
 * Removes the common leading whitespace from each line in a multiline string.
 *
 * This function calculates the minimum indentation level of all non-blank lines and
 * removes that amount of leading whitespace from every line. Useful for cleaning up
 * multiline strings without altering the relative indentation of lines.
 *
 * @param text - The multiline string to dedent.
 * @returns The de-dented string with common leading whitespace removed.
 */
export function dedent(text: string): string {
   const reducer = (minIndent: number, line: string) =>
      Math.min(minIndent, /^(\s*)/.exec(line)?.[0].length ?? 0);
   const lines = text.split("\n");
   const indent = lines
      .filter((line) => line.trim()) // Exclude blank lines
      .reduce(reducer, Number.POSITIVE_INFINITY);
   return lines.map((line) => line.slice(indent)).join("\n");
}

/** Swaps the case of every letter, so that `Src` becomes `sRC`. */
function swapCase(text: string): string {
   return Array.from(text, (char) =>
      char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase(),
   ).join("");
}

/**
 * Tells whether the file system that holds `directory` ignores case, so that `ipc/Main.ts` and
 * `ipc/main.ts` are one file. It looks up the same directory by a name with swapped case and checks
 * whether that finds the directory itself, so it writes nothing. The nearest existing ancestor
 * stands in for a directory that does not exist yet. Defaults to `false` when no part of the path
 * has a letter to swap.
 *
 * @param directory - A directory of the project, which need not exist.
 * @returns True if the file system ignores case.
 */
export async function isCaseInsensitiveFileSystem(directory: string): Promise<boolean> {
   const current = path.resolve(directory);
   const name = path.basename(current);
   const swapped = swapCase(name);
   if (swapped !== name) {
      const original = await fsp.stat(current, { bigint: true }).catch(() => null);
      if (original !== null) {
         const other = await fsp
            .stat(path.join(path.dirname(current), swapped), { bigint: true })
            .catch(() => null);
         return other !== null && other.ino === original.ino && other.dev === original.dev;
      }
   }
   const parent = path.dirname(current);
   return parent === current ? false : await isCaseInsensitiveFileSystem(parent);
}

export default {
   searchUpwards,
   resolveUserProjectPath,
   compareStrings,
   isSchemaSourceFile,
   concatRegex,
   isPathInside,
   isCaseInsensitiveFileSystem,
   dedent,
};
