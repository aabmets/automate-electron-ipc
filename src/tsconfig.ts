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
import utils from "./utils.js";

/** The `compilerOptions` that decide how the imports of the project are spelled. */
interface ModuleOptions {
   module?: string;
   moduleResolution?: string;
}

/** Replaces `//` and `/* *\/` comments with nothing, but keeps the newlines and the strings. */
function stripComments(text: string): string {
   let result = "";
   let index = 0;
   while (index < text.length) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"') {
         const end = stringEnd(text, index);
         result += text.slice(index, end);
         index = end;
      } else if (char === "/" && next === "/") {
         while (index < text.length && text[index] !== "\n") {
            index++;
         }
      } else if (char === "/" && next === "*") {
         const end = text.indexOf("*/", index + 2);
         index = end === -1 ? text.length : end + 2;
      } else {
         result += char;
         index++;
      }
   }
   return result;
}

/** The index after the string literal that starts at `start`. */
function stringEnd(text: string, start: number): number {
   let index = start + 1;
   while (index < text.length && text[index] !== '"') {
      index += text[index] === "\\" ? 2 : 1;
   }
   return Math.min(index + 1, text.length);
}

/** Removes the commas that are followed only by whitespace and a closing bracket. */
function stripTrailingCommas(text: string): string {
   let result = "";
   let index = 0;
   while (index < text.length) {
      const char = text[index];
      if (char === '"') {
         const end = stringEnd(text, index);
         result += text.slice(index, end);
         index = end;
      } else if (char === "," && /^\s*[}\]]/.test(text.slice(index + 1))) {
         index++;
      } else {
         result += char;
         index++;
      }
   }
   return result;
}

/** Parses the JSON with comments and trailing commas that `tsconfig.json` may hold. */
export function parseJsonc(text: string): unknown {
   const json = stripTrailingCommas(stripComments(text.replace(/^﻿/, "")));
   return JSON.parse(json);
}

async function readTsconfig(filePath: string): Promise<Record<string, unknown> | null> {
   let text: string;
   try {
      text = await fsp.readFile(filePath, "utf8");
   } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
         return null;
      }
      throw error;
   }
   let data: unknown;
   try {
      data = parseJsonc(String(text));
   } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot parse '${filePath}': it is not valid JSON. ${reason}`);
   }
   if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(`Cannot read '${filePath}': it must hold a JSON object.`);
   }
   return data as Record<string, unknown>;
}

/** The files that `extends` names by a relative path; a package name is skipped. */
function relativeBases(filePath: string, extendsValue: unknown): string[] {
   const names = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
   return names
      .filter((name): name is string => typeof name === "string" && /^\.{1,2}[\\/]/.test(name))
      .map((name) => {
         const resolved = utils.toPosix(path.resolve(path.dirname(filePath), name));
         return resolved.endsWith(".json") ? resolved : `${resolved}.json`;
      });
}

function ownOptions(data: Record<string, unknown>): ModuleOptions {
   const options = data.compilerOptions;
   if (typeof options !== "object" || options === null) {
      return {};
   }
   const { module, moduleResolution } = options as Record<string, unknown>;
   return {
      ...(typeof module === "string" ? { module } : {}),
      ...(typeof moduleResolution === "string" ? { moduleResolution } : {}),
   };
}

/**
 * The options of a tsconfig file as its bases and itself set them: the later base wins over the
 * earlier one, and the file wins over its bases.
 */
async function collectOptions(
   filePath: string,
   seen: string[],
   extender?: string,
): Promise<ModuleOptions> {
   const data = await readTsconfig(filePath);
   if (data === null) {
      // A missing project file is no config. A missing base is an error in the file that names it.
      if (extender === undefined) {
         return {};
      }
      throw new Error(`Cannot read '${extender}': the base config '${filePath}' does not exist.`);
   }
   const bases = relativeBases(filePath, data.extends).filter((base) => !seen.includes(base));
   const inherited = await Promise.all(
      bases.map((base) => collectOptions(base, [...seen, base], filePath)),
   );
   const merged = Object.assign({}, ...inherited) as ModuleOptions;
   return { ...merged, ...ownOptions(data) };
}

/**
 * Tells whether the project resolves its imports as NodeNext does: `module` or `moduleResolution`
 * of `<projectRoot>/tsconfig.json` is `node16` or `nodenext`, own or from a relative `extends`.
 * Only that file is read, and a project without one does not use NodeNext.
 *
 * @throws If a file that is read is not valid JSON, or a relative base does not exist.
 */
export async function detectNodeNext(projectRoot: string): Promise<boolean> {
   const filePath = utils.toPosix(path.join(projectRoot, "tsconfig.json"));
   const options = await collectOptions(filePath, [filePath]);
   return [options.module, options.moduleResolution].some((value) =>
      /^(node16|nodenext)$/i.test(value ?? ""),
   );
}
