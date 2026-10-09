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
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import { vi } from "vitest";
import { runTsc } from "./tsc-utils.js";

const root = path.resolve(import.meta.dirname, "../..");
const fixturesDir = path.join(root, "tests/fixtures");

/**
 * Compiler options for `typecheck` that resolve imports like Node does for ESM. The default
 * is `moduleResolution: "bundler"`, which also accepts the extensionless imports that
 * `projectUsesNodeNext` projects must not generate.
 */
export const NODE_NEXT_OPTIONS = { module: "NodeNext", moduleResolution: "NodeNext" } as const;

export interface RunFixtureOptions {
   /** Sub-directory of the fixture that is the project root. Defaults to the fixture root. */
   project?: string;
   /** Directory, relative to the fixture root, that the run starts from. Defaults to `project`. */
   cwd?: string;
   /**
    * The `ipcDataDir` of a fixture whose config lives in a config file, not in the
    * `package.json`. The run finds the file in the project root, so the file is part of the fixture.
    */
   ipcDataDir?: string;
}

export interface E2EProject {
   /** Absolute path of the temp copy of the fixture. */
   root: string;
   /** Absolute path of the project root inside the copy, where the generated files go. */
   dir: string;
   /** Directory of the generated files, relative to `dir`. */
   ipcDataDir: string;
   /** The generated files, keyed by file name. `utility.ts` exists only for utility channels. */
   generated: {
      "main.ts": string;
      "preload.ts": string;
      "window.d.ts": string;
      "utility.ts"?: string;
      /** The preload script and the typings of service workers exist only for worker channels. */
      "service-worker-preload.ts"?: string;
      "service-worker.d.ts"?: string;
   };
   /**
    * Type-checks the schema files and generated files, returns the tsc diagnostics.
    * `compilerOptions` are added to the ones of the generated tsconfig, and its `paths` to the
    * path mappings of the tsconfig.
    */
   typecheck: (compilerOptions?: Record<string, unknown>) => Promise<string>;
   /**
    * Type-checks the files of one scope of the page, as one renderer project would: `main.ts`,
    * `preload.<scope>.ts`, `window.<scope>.d.ts`, the schema files and the `schema-scope-<scope>.ts`
    * file. `"default"` is the surface of no scope, with `preload.ts` and `window.d.ts`. The files of
    * the other scopes are left out, since each `window*.d.ts` declares the same global.
    */
   typecheckScope: (scope: string, compilerOptions?: Record<string, unknown>) => Promise<string>;
   /**
    * Type-checks the files of a service worker as its own project, which has the `webworker` lib and
    * not the DOM one: `main.ts`, `service-worker-preload.ts`, `service-worker.d.ts`, the schema files
    * and the `schema-worker-*.ts` files, which use the API of the worker. The files of the page are
    * left out, since both `window.d.ts` and `service-worker.d.ts` declare the same global.
    */
   typecheckWorker: (compilerOptions?: Record<string, unknown>) => Promise<string>;
   /** Reads another generated file, such as `preload.settings.ts`. */
   read: (name: string) => Promise<string>;
   /** Deletes the temp dir. */
   cleanup: () => Promise<void>;
}

async function listFiles(dir: string): Promise<string[]> {
   const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
   return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Copies the fixture project into a temp dir, runs `ipcAutomation` from inside it, so that
 * the project root is resolved from the copy, and reads back the generated files.
 * If any step fails, the temp dir is deleted before the error is rethrown.
 */
export async function runFixture(
   fixture: string,
   options: RunFixtureOptions = {},
): Promise<E2EProject> {
   const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-e2e-"));
   const cleanup = () => fsp.rm(root, { recursive: true, force: true });
   try {
      await fsp.cp(path.join(fixturesDir, fixture), root, { recursive: true });
      const dir = path.join(root, options.project ?? ".");
      const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
      const autoipc = manifest.config?.autoipc ?? {};
      const ipcDataDir: string | undefined = options.ipcDataDir ?? autoipc.ipcDataDir;
      if (ipcDataDir === undefined) {
         throw new Error(
            `Fixture '${fixture}' sets no ipcDataDir in its package.json: pass the option.`,
         );
      }

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
         await ipcAutomation(path.join(root, options.cwd ?? options.project ?? "."));
      } finally {
         warnSpy.mockRestore();
      }

      const read = (name: string) => fsp.readFile(path.join(dir, ipcDataDir, name), "utf8");
      const utilityPath = path.join(
         dir,
         autoipc.utilityBindingsPath ?? path.join(ipcDataDir, "utility.ts"),
      );
      const utility = await fsp.readFile(utilityPath, "utf8").catch(() => undefined);
      const workerPreloadPath = path.join(
         dir,
         autoipc.serviceWorkerPreloadPath ?? path.join(ipcDataDir, "service-worker-preload.ts"),
      );
      const workerPreload = await fsp.readFile(workerPreloadPath, "utf8").catch(() => undefined);
      const workerTypes = await fsp
         .readFile(path.join(path.dirname(workerPreloadPath), "service-worker.d.ts"), "utf8")
         .catch(() => undefined);
      const generated = {
         "main.ts": await read("main.ts"),
         "preload.ts": await read("preload.ts"),
         "window.d.ts": await read("window.d.ts"),
         ...(utility === undefined ? {} : { "utility.ts": utility }),
         ...(workerPreload === undefined ? {} : { "service-worker-preload.ts": workerPreload }),
         ...(workerTypes === undefined ? {} : { "service-worker.d.ts": workerTypes }),
      };
      return {
         root,
         dir,
         ipcDataDir,
         generated,
         typecheck: (compilerOptions) => typecheckProject(dir, ipcDataDir, compilerOptions),
         typecheckScope: (scope, compilerOptions) =>
            typecheckProject(dir, ipcDataDir, compilerOptions, scope),
         typecheckWorker: (compilerOptions) =>
            typecheckProject(dir, ipcDataDir, compilerOptions, undefined, true),
         read,
         cleanup,
      };
   } catch (error) {
      // The caller never receives the handle of a failed run, so it cannot clean up itself.
      await cleanup();
      throw error;
   }
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
async function typecheckProject(
   dir: string,
   ipcDataDir: string,
   compilerOptions: Record<string, unknown> = {},
   scope?: string,
   worker = false,
): Promise<string> {
   const ipcDir = path.join(dir, ipcDataDir);
   // With a scope, the files are those of that scope alone. Without one, the files of the page are
   // those of the surface of no scope, and the files that use a scope are left out.
   const scopeSuffix = scope === undefined || scope === "default" ? "" : `.${scope}`;
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
              `${ipcDataDir}/main.ts`,
              ...(workerGenerated
                 ? [
                      workerGenerated.preload,
                      `${path.posix.dirname(workerGenerated.types)}/${workerCheckFile}`,
                   ]
                 : []),
              ...schemaFiles,
           ]
         : [
              ...["main.ts", `preload${scopeSuffix}.ts`, windowCheckFile].map(
                 (name) => `${ipcDataDir}/${name}`,
              ),
              ...(workerGenerated ? [workerGenerated.preload] : []),
              ...(await utilityFiles(dir, ipcDataDir)),
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
         path.join(ipcDir, `window${scopeSuffix}.d.ts`),
         path.join(ipcDir, windowCheckFile),
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
