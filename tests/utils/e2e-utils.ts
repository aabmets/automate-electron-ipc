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

export interface RunFixtureOptions {
   /** Sub-directory of the fixture that is the project root. Defaults to the fixture root. */
   project?: string;
   /** Directory, relative to the fixture root, that the run starts from. Defaults to `project`. */
   cwd?: string;
}

export interface E2EProject {
   /** Absolute path of the temp copy of the fixture. */
   root: string;
   /** Absolute path of the project root inside the copy, where the generated files go. */
   dir: string;
   /** Directory of the generated files, relative to `dir`. */
   ipcDataDir: string;
   /** The generated files, keyed by file name. */
   generated: { "main.ts": string; "preload.ts": string; "window.d.ts": string };
   /**
    * Type-checks the schema files and generated files, returns the tsc diagnostics.
    * `compilerOptions` are added to the ones of the generated tsconfig.
    */
   typecheck: (compilerOptions?: Record<string, unknown>) => Promise<string>;
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
      const ipcDataDir: string = manifest.config.autoipc.ipcDataDir;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
         await ipcAutomation(path.join(root, options.cwd ?? options.project ?? "."));
      } finally {
         warnSpy.mockRestore();
      }

      const read = (name: string) => fsp.readFile(path.join(dir, ipcDataDir, name), "utf8");
      const generated = {
         "main.ts": await read("main.ts"),
         "preload.ts": await read("preload.ts"),
         "window.d.ts": await read("window.d.ts"),
      };
      return {
         root,
         dir,
         ipcDataDir,
         generated,
         typecheck: (compilerOptions) => typecheckProject(dir, ipcDataDir, compilerOptions),
         cleanup,
      };
   } catch (error) {
      // The caller never receives the handle of a failed run, so it cannot clean up itself.
      await cleanup();
      throw error;
   }
}

/** Name of the `.ts` copy of `window.d.ts` that the type-check compiles in its place. */
const windowCheckFile = "window.dts-check.ts";

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
): Promise<string> {
   const ipcDir = path.join(dir, ipcDataDir);
   const schemaFiles = (await listFiles(ipcDir))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
      .map((file) => path.relative(dir, file).replaceAll("\\", "/"))
      .filter((file) => file.startsWith(`${ipcDataDir}/schema`));
   const tsconfig = {
      compilerOptions: {
         strict: true,
         noEmit: true,
         target: "ESNext",
         lib: ["ESNext", "DOM"],
         module: "ESNext",
         moduleResolution: "bundler",
         skipLibCheck: true,
         types: [],
         paths: {
            electron: [path.join(root, "node_modules/electron/electron.d.ts")],
            "automate-electron-ipc": [path.join(root, "types/index.d.ts")],
         },
         ...compilerOptions,
      },
      files: [
         ...["main.ts", "preload.ts", windowCheckFile].map((name) => `${ipcDataDir}/${name}`),
         ...schemaFiles,
      ],
   };
   const windowTypes = await fsp.readFile(path.join(ipcDir, "window.d.ts"), "utf8");
   const windowCheckPath = path.join(ipcDir, windowCheckFile);
   await fsp.writeFile(windowCheckPath, windowTypes);
   await fsp.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
   try {
      return runTsc(dir);
   } finally {
      await fsp.rm(windowCheckPath, { force: true });
   }
}
