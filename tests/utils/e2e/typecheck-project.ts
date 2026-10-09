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
import { scopedFilePath } from "@src/scopes.js";
import { runTsc } from "../tsc-utils.js";

const root = path.resolve(import.meta.dirname, "../../..");

async function listFiles(dir: string): Promise<string[]> {
   const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
   return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * The generated files of the page, relative to the project: the ones that the config moves, and
 * `main.ts`, `preload.ts` and `window.d.ts` in the data directory for the others.
 */
async function pageFiles(
   dir: string,
   ipcDataDir: string,
): Promise<{ main: string; preload: string; types: string }> {
   const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
   const autoipc = manifest.config?.autoipc ?? {};
   const file = (configured: string | undefined, name: string) =>
      (configured ?? `${ipcDataDir}/${name}`).replaceAll("\\", "/");
   return {
      main: file(autoipc.mainBindingsPath, "main.ts"),
      preload: file(autoipc.preloadBindingsPath, "preload.ts"),
      types: file(autoipc.rendererTypesPath, "window.d.ts"),
   };
}

/** The generated file for utility processes, as a list for the files of the type-check. */
async function utilityFiles(dir: string, ipcDataDir: string): Promise<string[]> {
   const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
   const utilityBindingsPath = manifest.config?.autoipc?.utilityBindingsPath;
   const file = (utilityBindingsPath ?? `${ipcDataDir}/utility.ts`).replaceAll("\\", "/");
   const exists = await fsp.access(path.join(dir, file)).then(
      () => true,
      () => false,
   );
   return exists ? [file] : [];
}

/**
 * The generated files for service workers, relative to the project: the preload script, and the
 * typings next to it. Absent when the schema has no channel to or from a worker.
 */
async function workerFiles(
   dir: string,
   ipcDataDir: string,
): Promise<{ preload: string; types: string } | null> {
   const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
   const configured = manifest.config?.autoipc?.serviceWorkerPreloadPath;
   const preload = (configured ?? `${ipcDataDir}/service-worker-preload.ts`).replaceAll("\\", "/");
   const exists = await fsp.access(path.join(dir, preload)).then(
      () => true,
      () => false,
   );
   return exists ? { preload, types: `${path.posix.dirname(preload)}/service-worker.d.ts` } : null;
}

/**
 * Finds the generated files that the check of the page includes besides `main.ts`, the preload
 * script and the typings: the ones that exist only for some schemas. Returns paths relative to
 * the project, none when the file was not generated.
 */
type ExtraFilesFinder = (dir: string, ipcDataDir: string) => Promise<string[]>;

/** The preload script of service workers, if the schema has channels to or from them. */
const workerPreloadFiles: ExtraFilesFinder = async (dir, ipcDataDir) => {
   const files = await workerFiles(dir, ipcDataDir);
   return files ? [files.preload] : [];
};

/**
 * The extra generated files of the check of the page. A new output that the check must include
 * adds one finder here.
 */
export const extraGeneratedFiles: ExtraFilesFinder[] = [workerPreloadFiles, utilityFiles];

/** Name of the `.ts` copy of `window.d.ts` that the type-check compiles in its place. */
const windowCheckFile = "window.dts-check.ts";
/** The same for `service-worker.d.ts`, which declares the same global as `window.d.ts` does. */
const workerCheckFile = "service-worker.dts-check.ts";

/**
 * Compiles the schema files, `main.ts`, `preload.ts` and `window.d.ts` of the project
 * against the `electron` types pinned by this repo, using a tiny tsconfig in the project dir.
 *
 * `skipLibCheck` skips every `.d.ts` file, including the generated `window.d.ts`, so that file
 * is compiled as a `.ts` copy instead. The copy replaces the original in the compiled files,
 * which avoids declaring the global `Window` members twice.
 */
export async function typecheckProject(
   dir: string,
   ipcDataDir: string,
   compilerOptions: Record<string, unknown> = {},
   scope?: string,
   worker = false,
): Promise<string> {
   const ipcDir = path.join(dir, ipcDataDir);
   // With a scope, the files are those of that scope alone. Without one, the files of the page are
   // those of the surface of no scope, and the files that use a scope are left out.
   const pageScope = scope === undefined || scope === "default" ? null : scope;
   const page = await pageFiles(dir, ipcDataDir);
   // The copy of the typings sits next to them, in the same directory.
   const windowCheck = `${path.posix.dirname(page.types)}/${windowCheckFile}`;
   const scopeFile = scope === undefined ? null : `${ipcDataDir}/schema-scope-${scope}.ts`;
   const schemaFiles = (await listFiles(ipcDir))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
      .map((file) => path.relative(dir, file).replaceAll("\\", "/"))
      .filter((file) => file.startsWith(`${ipcDataDir}/schema`))
      .filter((file) => !file.startsWith(`${ipcDataDir}/schema-scope-`) || file === scopeFile)
      // The files that use the API of a service worker are checked with the typings of the worker.
      .filter((file) => worker || !file.startsWith(`${ipcDataDir}/schema-worker-`));
   const workerGenerated = await workerFiles(dir, ipcDataDir);
   const tsconfig = {
      compilerOptions: {
         strict: true,
         noEmit: true,
         target: "ESNext",
         lib: worker ? ["ESNext", "WebWorker"] : ["ESNext", "DOM"],
         module: "ESNext",
         moduleResolution: "bundler",
         skipLibCheck: true,
         types: [],
         ...compilerOptions,
         // The path mappings of a test are added to the ones that the type-check needs.
         paths: {
            electron: [path.join(root, "node_modules/electron/electron.d.ts")],
            "automate-electron-ipc": [path.join(root, "types/index.d.ts")],
            ...(compilerOptions.paths as Record<string, string[]> | undefined),
         },
      },
      files: worker
         ? [
              page.main,
              ...(workerGenerated
                 ? [
                      workerGenerated.preload,
                      `${path.posix.dirname(workerGenerated.types)}/${workerCheckFile}`,
                   ]
                 : []),
              ...schemaFiles,
           ]
         : [
              page.main,
              scopedFilePath(page.preload, pageScope),
              windowCheck,
              ...(
                 await Promise.all(extraGeneratedFiles.map((find) => find(dir, ipcDataDir)))
              ).flat(),
              ...schemaFiles,
           ],
   };
   // The typings are compiled as a `.ts` copy, since `skipLibCheck` would skip a `.d.ts` file.
   const copies: [string, string][] = [];
   if (worker) {
      if (workerGenerated) {
         copies.push([
            path.join(dir, workerGenerated.types),
            path.join(dir, path.posix.dirname(workerGenerated.types), workerCheckFile),
         ]);
      }
   } else {
      copies.push([
         path.join(dir, scopedFilePath(page.types, pageScope)),
         path.join(dir, windowCheck),
      ]);
   }
   await Promise.all(
      copies.map(async ([from, to]) => fsp.writeFile(to, await fsp.readFile(from, "utf8"))),
   );
   await fsp.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
   try {
      return runTsc(dir);
   } finally {
      await Promise.all(copies.map(([, to]) => fsp.rm(to, { force: true })));
   }
}
