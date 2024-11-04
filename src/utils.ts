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
import type { FileHeader, IPCAutomationOption } from "@types";

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
   const startPath = startFrom.startsWith("file://") ? url.fileURLToPath(startFrom) : startFrom;
   let currentDir = path.dirname(startPath);
   while (true) {
      const possiblePath = path.resolve(currentDir, forPath);
      if (fs.existsSync(possiblePath)) {
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
 * Generates a SHA-256 hash of a given object.
 *
 * @param object - The object to be hashed.
 * @returns The hexadecimal SHA-256 hash of the object.
 */
function digestObject(object: object): string {
   const objStr = JSON.stringify(object);
   const hash = crypto.createHash("sha256");
   return hash.update(objStr).digest("hex");
}

/**
 * Constructs an IPC channel name based on the file path and function name.
 *
 * @param option - The IPC automation option provided by the user.
 * @param filePath - The file path used to derive channel segments.
 * @param funcName - The function name to include in the channel name.
 * @returns A string representing the IPC channel name.
 */
export function getChannelName(
   option: IPCAutomationOption,
   filePath: string,
   funcName: string,
): string {
   const optionDigest = digestObject(option).slice(0, 8);
   const parts = filePath.split(path.sep).map((part) => {
      const ext = path.extname(part);
      return ext === "" ? part : part.slice(0, part.length - ext.length);
   });
   return `${optionDigest}.${parts.join(".")}.${funcName}`;
}

export default {
   searchUpwards,
   concatRegex,
   dedent,
   isPathInside,
   extractFileHeader,
   digestObject,
   getChannelName,
};
