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
   const key = `${forPath}${startFrom}`;
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
   cache.put(key, "");
   return "";
}

/**
 * Finds, resolves and returns the users project directory,
 * optionally concatenating it with a relative sub-path.
 *
 * @returns Resolved sub-path in the users project directory.
 */
export function resolveUserProjectPath(subPath = ""): string {
   const basePath = path.dirname(searchUpwards(".git") || searchUpwards("node_modules"));
   return path.join(basePath, subPath).replaceAll("\\", "/");
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

/**
 * Finds and returns duplicates from an array.
 *
 * @param array - Collection of objects in an array.
 * @returns Found duplicates array.
 */
export function findDuplicates<T>(array: T[]): T[] {
   return array.reduce((acc, item, index, originalArray) => {
      if (originalArray.indexOf(item) !== index && !acc.includes(item)) {
         acc.push(item);
      }
      return acc;
   }, [] as T[]);
}

export default {
   searchUpwards,
   resolveUserProjectPath,
   concatRegex,
   isPathInside,
   dedent,
   findDuplicates,
};
