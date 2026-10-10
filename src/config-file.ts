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

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { transformSync } from "@swc/core";
import type * as t from "@types";
import utils from "./utils.js";

/** The names of the config file that the project root may hold, one at most. */
export const CONFIG_FILE_NAMES = [
   "autoipc.config.json",
   "autoipc.config.mjs",
   "autoipc.config.ts",
] as const;

/** The name of the config source of the manifest, as the messages spell it. */
export const MANIFEST_SOURCE = "package.json#config.autoipc";

export interface ConfigFile {
   /** The absolute path of the file, with `/` separators. */
   path: string;
   config: t.IPCOptionalConfig;
}

/** Spells a file as relative to the project root when it is inside it, else as an absolute path. */
export function describeConfigPath(projectRoot: string, filePath: string): string {
   const relative = path.posix.relative(projectRoot, filePath);
   return relative.startsWith("..") || path.posix.isAbsolute(relative) ? filePath : relative;
}

async function isFile(filePath: string): Promise<boolean> {
   const stats = await fsp.stat(filePath).catch(() => null);
   return stats?.isFile() ?? false;
}

/**
 * Finds the config file of the project: the one that `--config` names, relative to `cwd`, or else
 * the `autoipc.config.*` file in the project root.
 *
 * @returns The absolute path with `/` separators, or `null` when the project has no config file.
 * @throws If `configFile` does not exist or is of a type that cannot be read, or if the project
 * root holds more than one config file.
 */
export async function findConfigFile(
   projectRoot: string,
   cwd: string | undefined,
   configFile: string | undefined,
): Promise<string | null> {
   if (configFile !== undefined) {
      const filePath = utils.toPosix(path.resolve(cwd ?? process.cwd(), configFile));
      if (!(await isFile(filePath))) {
         throw new Error(`The config file '${filePath}' does not exist.`);
      }
      if (!/\.(json|mjs|ts)$/.test(filePath)) {
         throw new Error(
            `Cannot read the config file '${filePath}': use a .json, .mjs or .ts file.`,
         );
      }
      return filePath;
   }
   const candidates = CONFIG_FILE_NAMES.map((name) => utils.toPosix(path.join(projectRoot, name)));
   const exists = await Promise.all(candidates.map(isFile));
   const found = candidates.filter((_, index) => exists[index]);
   if (found.length > 1) {
      const names = found.map((f) => `'${f}'`).join(" and ");
      throw new Error(`The project has more than one config file: ${names}. Keep one.`);
   }
   return found[0] ?? null;
}

/** Imports an `.mjs` file under a URL that no earlier import used, so that it is read afresh. */
async function importFresh(filePath: string): Promise<unknown> {
   const fileUrl = `${url.pathToFileURL(filePath).href}?v=${crypto.randomUUID()}`;
   const mod = (await import(/* @vite-ignore */ fileUrl)) as { default?: unknown };
   return mod.default;
}

/**
 * Transpiles a `.ts` config file to a temp `.mjs` file next to it and imports that. The temp file
 * is deleted whether or not the import succeeds. Relative imports of `.ts` files from the config
 * are not supported, since the temp file has nothing to resolve them with.
 */
async function importTypeScript(filePath: string): Promise<unknown> {
   const source = await fsp.readFile(filePath, "utf8");
   const { code } = transformSync(source, {
      filename: filePath,
      swcrc: false,
      configFile: false,
      sourceMaps: false,
      module: { type: "es6" },
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
   });
   const tempPath = path.join(
      path.dirname(filePath),
      `.autoipc.config.${crypto.randomBytes(6).toString("hex")}.mjs`,
   );
   await fsp.writeFile(tempPath, code);
   try {
      return await importFresh(tempPath);
   } finally {
      await fsp.rm(tempPath, { force: true });
   }
}

async function readExport(filePath: string): Promise<unknown> {
   if (filePath.endsWith(".json")) {
      return JSON.parse(await fsp.readFile(filePath, "utf8"));
   }
   const exported = filePath.endsWith(".ts")
      ? await importTypeScript(filePath)
      : await importFresh(filePath);
   return typeof exported === "function" ? await exported() : exported;
}

/**
 * Reads a config file. A `.json` file holds the config object. In an `.mjs` or `.ts` file the
 * default export is the config object, or a function, sync or async, that returns it.
 *
 * @throws If the file cannot be parsed or run, or does not give an object.
 */
export async function loadConfigFile(projectRoot: string, filePath: string): Promise<ConfigFile> {
   const name = describeConfigPath(projectRoot, filePath);
   let config: unknown;
   try {
      config = await readExport(filePath);
   } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot load the config file '${name}': ${reason}`, { cause: error });
   }
   if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new Error(`The config file '${name}' must give an object as its config.`);
   }
   return { path: filePath, config: config as t.IPCOptionalConfig };
}
