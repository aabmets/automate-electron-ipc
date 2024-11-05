/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { LRUCache } from "@src/cache";
import type { FileHeader } from "@types";

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
   const basePath = path.dirname(searchUpwards(".git") || searchUpwards("package.json"));
   return path.join(basePath, subPath);
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
      Math.min(minIndent, line.match(/^(\s*)/)?.[0].length || 0);
   const lines = text.split("\n");
   const indent = lines
      .filter((line) => line.trim()) // Exclude blank lines
      .reduce(reducer, Number.POSITIVE_INFINITY);
   return lines.map((line) => line.slice(indent)).join("\n");
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
 * Extracts the shebang and license header from the beginning of a file's content.
 *
 * @param fileContents - The full contents of the file as a string.
 * @returns An object containing the shebang (if present) and license information
 *          extracted from the file header, or null for each if not present.
 */
export function extractFileHeader(fileContents: string): FileHeader {
   const header: FileHeader = { shebang: null, license: null };
   if (!fileContents) {
      return header;
   }
   const lines = fileContents.split("\n");
   const licenseLines: string[] = [];

   for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (i === 0 && line.startsWith("#!")) {
         header.shebang = line;
      } else if (line.startsWith("// NOTICE:")) {
         break;
      } else if (
         line === "" ||
         line.startsWith("//") ||
         line.startsWith("/*") ||
         line.startsWith(" *")
      ) {
         licenseLines.push(line);
      } else {
         break;
      }
   }
   if (licenseLines.length > 0) {
      header.license = licenseLines.join("\n");
   }
   return header;
}

/**
 * Generates a SHA-256 hash of given objects and/or strings.
 *
 * @param data - A rest parameter of objects and/or strings to be hashed together.
 * @returns The hexadecimal SHAKE-256 hash of the data input.
 */
function digestData(...data: (object | string)[]): string {
   const hash = crypto.createHash("shake256");
   data.forEach((item) => {
      hash.update(typeof item === "string" ? item : JSON.stringify(data));
   });
   return hash.digest("hex");
}

/**
 * Converts a given filesystem path to a normalized import path by replacing
 * all path separators with forward slashes and removing the file extension.
 *
 * @param relativePath - The relative filesystem path to normalize.
 * @returns - The normalized import path without the file extension.
 */
export function getImportPath(relativePath: string): string {
   const normalizedPath = relativePath.replaceAll(path.sep, "/");
   const ext = path.extname(normalizedPath);
   return normalizedPath.slice(0, normalizedPath.length - ext.length);
}

export default {
   searchUpwards,
   resolveUserProjectPath,
   concatRegex,
   dedent,
   isPathInside,
   extractFileHeader,
   digestData,
   getImportPath,
};
