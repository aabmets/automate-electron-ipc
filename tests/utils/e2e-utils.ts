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
import { typecheckFiles, typecheckProject } from "./e2e/typecheck-project.js";

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
   /**
    * Options that are merged into the `config.autoipc` of the `package.json` of the copy before the
    * run, to run one fixture with different outputs, such as `mainBindingsPath`. An option set to
    * `undefined` is removed.
    */
   config?: Record<string, unknown>;
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
      /** The types module, which holds `IpcApi` and the helper types. */
      "types.ts": string;
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
   /**
    * Type-checks only the given files, relative to the project root, which the test lists with
    * the generated files it wants. The files of the project that are not named are not compiled.
    */
   typecheckFiles: (files: string[], compilerOptions?: Record<string, unknown>) => Promise<string>;
   /** Reads another generated file, such as `preload.settings.ts`. */
   read: (name: string) => Promise<string>;
   /** Deletes the temp dir. */
   cleanup: () => Promise<void>;
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
      const manifestPath = path.join(dir, "package.json");
      const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
      if (options.config !== undefined) {
         manifest.config = { ...manifest.config, autoipc: { ...manifest.config?.autoipc } };
         Object.assign(manifest.config.autoipc, options.config);
         await fsp.writeFile(manifestPath, JSON.stringify(manifest));
      }
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
      const readOutput = (configured: string | undefined, name: string) =>
         fsp.readFile(path.join(dir, configured ?? path.join(ipcDataDir, name)), "utf8");
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
         "main.ts": await readOutput(autoipc.mainBindingsPath, "main.ts"),
         "preload.ts": await readOutput(autoipc.preloadBindingsPath, "preload.ts"),
         "window.d.ts": await readOutput(autoipc.rendererTypesPath, "window.d.ts"),
         "types.ts": await read("types.ts"),
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
         typecheckFiles: (files, compilerOptions) => typecheckFiles(dir, files, compilerOptions),
         read,
         cleanup,
      };
   } catch (error) {
      // The caller never receives the handle of a failed run, so it cannot clean up itself.
      await cleanup();
      throw error;
   }
}
