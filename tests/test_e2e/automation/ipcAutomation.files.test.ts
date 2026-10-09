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
import { GENERATED_PREFIX } from "@src/output-files.js";
import { runFixture } from "@testutils/e2e-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("ipcAutomation, single schema file", () => {
   it("generates the three files from the channels of schema.ts", async () => {
      const project = await fixtures.run("single-file");
      const { generated } = project;

      expect(generated["main.ts"]).toContain("getUser");
      expect(generated["main.ts"]).toContain("echoUserName");
      expect(generated["main.ts"]).toContain("windowFocused");
      expect(generated["preload.ts"]).toContain("echoUserName: {\n      send:");
      expect(generated["types.ts"]).toContain("echoUserName: {\n      send:");
      expect(generated["types.ts"]).toContain('import type { User } from "./schema";');
      expect(generated["types.ts"]).toContain(
         "getUser: {\n      /** @throws {IpcError} */\n      invoke: (id: number) => Promise<User>;",
      );
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("single-file");
      expect(await project.typecheck()).toBe("");
   });
});

describe("e2e harness", () => {
   // Regression for T50: `skipLibCheck` hid every error in the generated `window.d.ts`.
   it("reports errors in the generated window.d.ts", async () => {
      const project = await fixtures.run("single-file");
      const windowTypes = path.join(project.dir, project.ipcDataDir, "window.d.ts");
      await fsp.appendFile(windowTypes, '\nimport type { Missing } from "./does-not-exist";\n');

      const diagnostics = await project.typecheck();
      expect(diagnostics).toContain("window.dts-check.ts");
      expect(diagnostics).toContain("does-not-exist");
   });

   it("leaves no helper file behind", async () => {
      const project = await fixtures.run("single-file");
      await project.typecheck();
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("window.dts-check.ts");
   });
});

describe("ipcAutomation, schema directory", () => {
   it("reads channels from nested files, without relying on Bun-only fs APIs", async () => {
      // Regression for B1: `fsp.exists` exists only in Bun, so directory mode threw on Node.
      const original = Object.getOwnPropertyDescriptor(fsp, "exists");
      Object.defineProperty(fsp, "exists", {
         configurable: true,
         value: () => {
            throw new TypeError("fsp.exists is not a function");
         },
      });
      const project = await fixtures.run("schema-dir").finally(() => {
         if (original) {
            Object.defineProperty(fsp, "exists", original);
         } else {
            Reflect.deleteProperty(fsp, "exists");
         }
      });
      const { generated } = project;

      expect(generated["main.ts"]).toContain("getUser");
      expect(generated["main.ts"]).toContain("renameUser");
      expect(generated["main.ts"]).toContain("windowBlurred");
      expect(generated["preload.ts"]).toContain("renameUser: {\n      send:");
      expect(generated["types.ts"]).toContain("logStream");
   });

   // Regression for T08: a README, a JSON file and a `.d.ts` that repeats a channel name used
   // to be read from the schema directory.
   it("ignores files that are not schema sources", async () => {
      const project = await fixtures.run("schema-dir");
      expect(project.generated["main.ts"].match(/getUser: \{/g)).toHaveLength(1);
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("schema-dir");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, duplicate channels across files", () => {
   it("rejects the same channel name declared in two schema files", async () => {
      // Regression for B2: validation ran per file, so this produced duplicate keys in the output.
      await expect(runFixture("duplicate-channels")).rejects.toThrowError(
         /Channel name 'getUser' is declared in both 'a\.ts' \(\d+:\d+\) and 'b\.ts' \(\d+:\d+\)\. /,
      );
   });
});

describe("ipcAutomation, workspace", () => {
   // Regression for T07: the project root was the first .git above the library, which is the
   // repo root of a workspace. The root package.json here points at a different, wrong dir.
   it("generates into the app package when run from one of its sub-directories", async () => {
      const project = await fixtures.run("workspace", {
         project: "packages/app",
         cwd: "packages/app/src/main",
      });

      expect(project.generated["main.ts"]).toContain("getUser");
      expect(project.generated["preload.ts"]).toContain("echoUserName: {\n      send:");
      expect(project.generated["types.ts"]).toContain("invoke: (id: number) =>");
      await expect(fsp.stat(path.join(project.root, "wrong"))).rejects.toMatchObject({
         code: "ENOENT",
      });
      await expect(
         fsp.stat(path.join(project.root, "packages/app/src/main/ipc")),
      ).rejects.toMatchObject({ code: "ENOENT" });
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("workspace", { project: "packages/app" });
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, wrapped channel map export", () => {
   // Regression for T58: `export default defineChannels({...}) satisfies X` was rejected.
   it("generates bindings for a map followed by satisfies", async () => {
      const project = await fixtures.run("export-forms");
      expect(project.generated["main.ts"]).toContain("getUser");
      expect(project.generated["preload.ts"]).toContain("echoUserName: {\n      send:");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("export-forms");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, generated file start", () => {
   // Regression for T65: every generated file started with a blank line.
   it.each(["single-file", "no-channels", "port-only"])(
      "starts every generated file of '%s' with the notice",
      async (fixture) => {
         const project = await fixtures.run(fixture);
         for (const contents of Object.values(project.generated)) {
            expect(contents.startsWith(GENERATED_PREFIX)).toBe(true);
            expect(contents).not.toMatch(/\n\n\n/);
         }
      },
   );
});

describe("ipcAutomation, schema without channels", () => {
   // Regression for T51: the empty window.d.ts had no import or export, so tsc rejected the
   // global augmentation with TS2669. It imports `IpcApi` now, which makes it a module.
   it("generates an empty window.d.ts that is a module, and an empty types.ts", async () => {
      const project = await fixtures.run("no-channels");
      expect(project.generated["window.d.ts"]).toContain('import type { IpcApi } from "./types";');
      expect(project.generated["types.ts"]).toContain("export interface IpcApi {}");
      expect(project.generated["types.ts"]).toContain("export type ChannelName = never;");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("no-channels");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema with only port channels", () => {
   // Regression for T52: the empty callables line left a lone comma in main.ts and preload.ts.
   it("generates bindings without a dangling comma", async () => {
      const project = await fixtures.run("port-only");
      const { generated } = project;

      expect(generated["main.ts"]).toContain("export const ipc = {\n   chat: {\n      connect:");
      expect(generated["preload.ts"]).toContain(
         "export const api = {\n   chat: ports['chat'].api,",
      );
      expect(generated["types.ts"]).toContain("interface IpcApi {\n   chat: {\n      send:");
      expect(generated["main.ts"]).not.toMatch(/\{\s*,/);
      expect(generated["preload.ts"]).not.toMatch(/\{\s*,/);
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("port-only");
      expect(await project.typecheck()).toBe("");
   });

   // Regression for T65: main.ts imported `ipcMain` without using it. T25 uses it, to hear a page
   // end a connection.
   it("imports nothing unused, so the files type-check under noUnusedLocals", async () => {
      const project = await fixtures.run("port-only");
      expect(project.generated["main.ts"]).toContain(
         'import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";',
      );
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
   });
});
