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
import utils from "@src/utils.js";
import { vi } from "vitest";
import { runTsc } from "./tsc-utils.js";

const root = path.resolve(import.meta.dirname, "../..");
const fixturesDir = path.join(root, "tests/fixtures");

export interface E2EProject {
   /** Absolute path of the temp copy of the fixture, used as the project root. */
   dir: string;
   /** Directory of the generated files, relative to `dir`. */
   ipcDataDir: string;
   /** The generated files, keyed by file name. */
   generated: { "main.ts": string; "preload.ts": string; "window.d.ts": string };
   /** Type-checks the schema files and generated files, returns the tsc diagnostics. */
   typecheck: () => Promise<string>;
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
 * Copies the fixture project into a temp dir, points the project root of the library at it,
 * runs `ipcAutomation` and reads back the generated files.
 */
export async function runFixture(fixture: string): Promise<E2EProject> {
   const dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-e2e-"));
   await fsp.cp(path.join(fixturesDir, fixture), dir, { recursive: true });
   const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
   const ipcDataDir: string = manifest.config.autoipc.ipcDataDir;

   const rootSpy = vi.spyOn(utils, "resolveUserProjectPath");
   rootSpy.mockImplementation((subPath = "") => path.join(dir, subPath).replaceAll("\\", "/"));
   const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
   try {
      await ipcAutomation();
   } finally {
      rootSpy.mockRestore();
      warnSpy.mockRestore();
   }

   const read = (name: string) => fsp.readFile(path.join(dir, ipcDataDir, name), "utf8");
   const generated = {
      "main.ts": await read("main.ts"),
      "preload.ts": await read("preload.ts"),
      "window.d.ts": await read("window.d.ts"),
   };
   return {
      dir,
      ipcDataDir,
      generated,
      typecheck: () => typecheckProject(dir, ipcDataDir),
      cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
   };
}

/**
 * Compiles the schema files, `main.ts`, `preload.ts` and `window.d.ts` of the project
 * against the `electron` types pinned by this repo, using a tiny tsconfig in the project dir.
 */
async function typecheckProject(dir: string, ipcDataDir: string): Promise<string> {
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
      },
      files: [
         ...["main.ts", "preload.ts", "window.d.ts"].map((name) => `${ipcDataDir}/${name}`),
         ...schemaFiles,
      ],
   };
   await fsp.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
   return runTsc(dir);
}
