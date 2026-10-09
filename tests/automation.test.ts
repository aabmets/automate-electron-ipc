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
import cfg from "@src/config.js";
import logger from "@src/logger.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   let dir: string;

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-automation-"));
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   const mockConfig = (overrides: Partial<t.IPCResolvedConfig>) => {
      vi.spyOn(cfg, "getResolvedConfig").mockResolvedValue({
         codeIndent: 3,
         projectUsesNodeNext: false,
         mainBindingsFilePath: path.join(dir, "out/main.ts"),
         preloadBindingsFilePath: path.join(dir, "out/preload.ts"),
         rendererTypesFilePath: path.join(dir, "out/window.d.ts"),
         utilityBindingsFilePath: path.join(dir, "out/utility.ts"),
         ...overrides,
      } as t.IPCResolvedConfig);
   };

   it("resolves the config from the given cwd", async () => {
      const schemaPath = path.join(dir, "schema.ts");
      mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);

      await ipcAutomation("/work/packages/app");

      expect(cfg.getResolvedConfig).toHaveBeenCalledWith("/work/packages/app");
   });

   it("creates the schema directory and skips when the schema path does not exist", async () => {
      const schemaPath = path.join(dir, "ipc/schema.ts");
      mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      const warn = vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect((await fsp.stat(path.dirname(schemaPath))).isDirectory()).toBe(true);
      await expect(fsp.stat(path.join(dir, "out/main.ts"))).rejects.toMatchObject({
         code: "ENOENT",
      });
   });

   it("writes empty bindings and warns when the schema has no channels", async () => {
      const schemaPath = path.join(dir, "schema.ts");
      await fsp.writeFile(schemaPath, "export const x = 1;\n");
      mockConfig({
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const warn = vi.spyOn(logger, "noChannelExpressions").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain(
         "ANY CHANGES TO THIS FILE WILL NOT PERSIST",
      );
   });

   it("generates identical output however readdir orders files and reads complete", async () => {
      // Regression for T06: files were pushed in read completion order, so the order of the
      // generated imports and members changed between runs.
      const schemaDir = path.join(dir, "schema");
      await fsp.mkdir(path.join(schemaDir, "nested"), { recursive: true });
      const files: Record<string, string> = {
         "z.ts": "zulu",
         "m.mts": "mike",
         "a.ts": "alpha",
         "nested/b.ts": "bravo",
         "nested/a.ts": "atlas",
      };
      const names = Object.keys(files);
      await Promise.all(
         Object.entries(files).map(([name, prefix]) =>
            fsp.writeFile(
               path.join(schemaDir, name),
               [
                  'import { defineChannels, send, port } from "automate-electron-ipc";',
                  "export default defineChannels({",
                  `   ${prefix}Ping: send<() => void>(),`,
                  `   ${prefix}Link: port<(msg: string) => void>(),`,
                  "});",
               ].join("\n"),
            ),
         ),
      );
      mockConfig({ ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) } } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      const realReaddir = fsp.readdir.bind(fsp);
      const realReadFile = fsp.readFile.bind(fsp);
      let permutation = 0;
      vi.spyOn(fsp, "readdir").mockImplementation((async (
         ...args: Parameters<typeof realReaddir>
      ) => {
         const files = (await realReaddir(...args)) as string[];
         const offset = permutation % files.length;
         const rotated = [...files.slice(offset), ...files.slice(0, offset)];
         return permutation % 2 === 0 ? rotated : rotated.reverse();
      }) as never);
      vi.spyOn(fsp, "readFile").mockImplementation((async (
         ...args: Parameters<typeof realReadFile>
      ) => {
         // Files that are listed first complete last.
         const delay = 5 * (names.length - names.findIndex((n) => String(args[0]).endsWith(n)));
         await new Promise((resolve) => setTimeout(resolve, delay * (permutation % 2 ? 1 : 3)));
         return realReadFile(...args);
      }) as never);

      const outputs: string[] = [];
      const reportedOrders: string[][] = [];
      for (permutation = 0; permutation < 5; permutation++) {
         // biome-ignore lint/performance/noAwaitInLoops: the runs must be sequential
         await ipcAutomation();
         reportedOrders.push(success.mock.lastCall?.[0].map((pfs) => pfs.relativePath) ?? []);
         const contents = await Promise.all(
            ["main.ts", "preload.ts", "window.d.ts"].map((name) =>
               fsp.readFile(path.join(dir, "out", name), "utf8"),
            ),
         );
         outputs.push(contents.join("\n=====\n"));
      }

      const expectedOrder = [
         "a.ts",
         "m.mts",
         path.join("nested", "a.ts"),
         path.join("nested", "b.ts"),
         "z.ts",
      ];
      for (const order of reportedOrders) {
         expect(order).toStrictEqual(expectedOrder);
      }
      for (const output of outputs) {
         expect(output).toStrictEqual(outputs[0]);
      }
   });

   it("reports a single schema file under the configured data dir", async () => {
      // Regression for T58: a stale "src/ipc" fallback disagreed with the "src/autoipc" default.
      const schemaPath = path.join(dir, "src/autoipc/schema.ts");
      await fsp.mkdir(path.dirname(schemaPath), { recursive: true });
      await fsp.writeFile(
         schemaPath,
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({ getUser: invoke<() => Promise<string>>() });",
         ].join("\n"),
      );
      mockConfig({
         ipcDataDir: "src/autoipc",
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(success.mock.calls[0][0].map((pfs) => pfs.relativePath)).toStrictEqual([
         "src/autoipc",
      ]);
   });

   describe("the file for utility processes", () => {
      const generate = async (channels: string) => {
         const schemaPath = path.join(dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, invoke, callUtility, invokeUtility } from "automate-electron-ipc";',
               `export default defineChannels({ ${channels} });`,
            ].join("\n"),
         );
         mockConfig({
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         await ipcAutomation();
      };

      it("is written when the schema has a channel to the utility process", async () => {
         await generate("getUser: invoke<() => Promise<string>>(), run: callUtility<() => void>()");

         const utility = await fsp.readFile(path.join(dir, "out/utility.ts"), "utf8");
         expect(utility).toContain("ANY CHANGES TO THIS FILE WILL NOT PERSIST");
         expect(utility).toContain("   run: {");
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain(
            "attachUtility",
         );
      });

      it("is written to the configured path, whose directories are created", async () => {
         const utilityBindingsFilePath = path.join(dir, "worker/generated/ipc.ts");
         const schemaPath = path.join(dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, callUtility } from "automate-electron-ipc";',
               "export default defineChannels({ run: callUtility<() => void>() });",
            ].join("\n"),
         );
         mockConfig({
            utilityBindingsFilePath,
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

         await ipcAutomation();

         expect(await fsp.readFile(utilityBindingsFilePath, "utf8")).toContain("   run: {");
      });

      it("is written for a schema which has only a channel from a page to the utility process", async () => {
         await generate("run: invokeUtility<() => Promise<number>>()");

         const utility = await fsp.readFile(path.join(dir, "out/utility.ts"), "utf8");
         expect(utility).toContain("   run: {\n      handle:");
         const main = await fsp.readFile(path.join(dir, "out/main.ts"), "utf8");
         expect(main).toContain("connectUtilityPort('run', child, target)");
         expect(await fsp.readFile(path.join(dir, "out/preload.ts"), "utf8")).toContain(
            "callUtilityPort(utilityClients['run'], args)",
         );
      });

      it("is not written for a schema without such a channel", async () => {
         await generate("getUser: invoke<() => Promise<string>>()");

         await expect(fsp.stat(path.join(dir, "out/utility.ts"))).rejects.toMatchObject({
            code: "ENOENT",
         });
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).not.toContain(
            "UtilityProcess",
         );
      });
   });

   describe("the files of the scopes", () => {
      const SCHEMA = [
         'import { defineChannels, invoke, send } from "automate-electron-ipc";',
         "export default defineChannels({",
         "   getVersion: invoke<() => Promise<string>>(),",
         '   getSettings: invoke<() => Promise<string>>({ scopes: ["settings"] }),',
         '   note: send<(text: string) => void>({ scopes: ["settings", "plugin-host"] }),',
         "});",
      ].join("\n");
      const generate = async (schema: string, overrides: Partial<t.IPCResolvedConfig> = {}) => {
         const schemaPath = path.join(dir, "schema.ts");
         await fsp.writeFile(schemaPath, schema);
         mockConfig({
            projectRoot: dir,
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
            ...overrides,
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         await ipcAutomation();
      };
      const written = async () => (await fsp.readdir(path.join(dir, "out"))).sort();

      it("writes a preload script and a declaration file for each scope, next to the usual ones", async () => {
         await generate(SCHEMA);

         expect(await written()).toStrictEqual([
            "main.ts",
            "preload.plugin-host.ts",
            "preload.settings.ts",
            "preload.ts",
            "window.d.ts",
            "window.plugin-host.d.ts",
            "window.settings.d.ts",
         ]);
      });

      it("gives each file the channels of its surface", async () => {
         await generate(SCHEMA);
         const read = (name: string) => fsp.readFile(path.join(dir, "out", name), "utf8");
         const channelsOf = (text: string) =>
            [...text.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);

         expect(channelsOf(await read("preload.ts"))).toStrictEqual(["getVersion"]);
         expect(channelsOf(await read("preload.settings.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("preload.plugin-host.ts"))).toStrictEqual([
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("window.settings.d.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
         expect(channelsOf(await read("main.ts"))).toStrictEqual([
            "getSettings",
            "getVersion",
            "note",
         ]);
      });

      it("writes only the usual files for a schema without scopes", async () => {
         await generate(
            SCHEMA.replaceAll(/, \{ scopes: \[[^\]]*\] \}|\{ scopes: \[[^\]]*\] \}/g, "{}"),
         );

         expect(await written()).toStrictEqual(["main.ts", "preload.ts", "window.d.ts"]);
      });

      it("writes the empty files of the surface of no scope when every channel has scopes", async () => {
         await generate(
            [
               'import { defineChannels, invoke } from "automate-electron-ipc";',
               'export default defineChannels({ a: invoke<() => void>({ scopes: ["one"] }) });',
            ].join("\n"),
         );
         const read = (name: string) => fsp.readFile(path.join(dir, "out", name), "utf8");

         expect(await read("preload.ts")).toContain("export const api = {};");
         expect(await read("window.d.ts")).toContain("interface IpcApi {}");
         expect(await read("preload.one.ts")).toContain("   a: {");
      });

      it("rejects a utility path which is the file of a scope, and writes nothing", async () => {
         await expect(
            generate(SCHEMA, {
               utilityBindingsFilePath: path.join(dir, "out/preload.settings.ts"),
            }),
         ).rejects.toThrowError(
            /'utilityBindingsPath' \(.*preload\.settings\.ts'\) is the file that the scope 'settings' is generated to/,
         );
         expect(await fsp.readdir(dir)).toStrictEqual(["schema.ts"]);
      });

      it("rejects a utility path which is the declaration file of a scope", async () => {
         await expect(
            generate(SCHEMA, {
               utilityBindingsFilePath: path.join(dir, "out/window.plugin-host.d.ts"),
            }),
         ).rejects.toThrowError(/is the file that the scope 'plugin-host' is generated to/);
      });

      it("rejects an invalid scope name with the channel and the file", async () => {
         await expect(
            generate(
               [
                  'import { defineChannels, invoke } from "automate-electron-ipc";',
                  'export default defineChannels({ a: invoke<() => void>({ scopes: ["Not Valid"] }) });',
               ].join("\n"),
            ),
         ).rejects.toThrowError(/is not a scope name/);
      });
   });

   it("passes the project root to the success report", async () => {
      // Regression for T71: the report cut paths at the first occurrence of the data dir name.
      const schemaPath = path.join(dir, "schema.ts");
      await fsp.writeFile(
         schemaPath,
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({ getUser: invoke<() => Promise<string>>() });",
         ].join("\n"),
      );
      mockConfig({
         projectRoot: dir,
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(success).toHaveBeenCalledOnce();
      expect(success.mock.calls[0][1]).toBe(dir);
   });

   it("reads only .ts, .mts and .cts files, ignoring declaration files", async () => {
      // Regression for T08: every file under schema/ was read and parsed.
      const schemaDir = path.join(dir, "schema");
      await fsp.mkdir(schemaDir, { recursive: true });
      const source = (channel: string) =>
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            `export default defineChannels({ ${channel}: invoke<() => Promise<void>>() });`,
         ].join("\n");
      await fsp.writeFile(path.join(schemaDir, "a.ts"), source("alpha"));
      await fsp.writeFile(path.join(schemaDir, "b.mts"), source("bravo"));
      await fsp.writeFile(path.join(schemaDir, "c.cts"), source("charlie"));
      await fsp.writeFile(path.join(schemaDir, "d.d.ts"), source("alpha"));
      await fsp.writeFile(path.join(schemaDir, "e.d.mts"), source("alpha"));
      await fsp.writeFile(path.join(schemaDir, "f.js"), source("alpha"));
      await fsp.writeFile(path.join(schemaDir, "notes.md"), "export default defineChannels({ [");
      await fsp.writeFile(path.join(schemaDir, "data.json"), "{");
      await fsp.mkdir(path.join(schemaDir, "folder.ts"));
      mockConfig({ ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) } } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      const reported = success.mock.calls[0][0].map((pfs) => pfs.relativePath);
      expect(reported.sort()).toStrictEqual(["a.ts", "b.mts", "c.cts"]);
   });

   it("rejects with the file position when a schema file has a syntax error", async () => {
      // Regression for T08: swc parse errors were swallowed.
      const schemaPath = path.join(dir, "schema.ts");
      await fsp.writeFile(schemaPath, "export default defineChannels({ a: ;\n});");
      mockConfig({
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);

      await expect(ipcAutomation()).rejects.toThrowError(
         `Syntax error in schema file '${schemaPath}:1:36'`,
      );
      await expect(fsp.stat(path.join(dir, "out/main.ts"))).rejects.toMatchObject({
         code: "ENOENT",
      });
   });

   it("skips schema directory files without channels", async () => {
      const schemaDir = path.join(dir, "schema");
      await fsp.mkdir(path.join(schemaDir, "nested"), { recursive: true });
      await fsp.writeFile(path.join(schemaDir, "helpers.ts"), "export const x = 1;\n");
      await fsp.writeFile(
         path.join(schemaDir, "nested/user.ts"),
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({",
            "   getUser: invoke<(id: number) => Promise<string>>(),",
            "});",
            "",
         ].join("\n"),
      );
      mockConfig({ ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) } } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      const reported = success.mock.calls[0][0];
      expect(reported.map((pfs) => pfs.relativePath)).toStrictEqual([
         path.join("nested", "user.ts"),
      ]);
      expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain("getUser");
   });

   describe("structured clone", () => {
      const schema = (signature: string) =>
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export class User {}",
            "export default defineChannels({",
            `   save: invoke<${signature}>(),`,
            "});",
            "",
         ].join("\n");

      const run = async (contents: string) => {
         const schemaPath = path.join(dir, "ipc/schema.ts");
         await fsp.mkdir(path.dirname(schemaPath), { recursive: true });
         await fsp.writeFile(schemaPath, contents);
         mockConfig({
            ipcDataDir: "ipc/schema.ts",
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         return ipcAutomation();
      };

      it("warns about a class instance, and still generates the bindings", async () => {
         const warn = vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await run(schema("(user: User) => Promise<void>"));

         expect(warn).toHaveBeenCalledTimes(1);
         expect(warn.mock.calls[0][0]).toStrictEqual([
            expect.stringContaining(
               "Schema file 'ipc/schema.ts': Channel 'save': parameter 'user'",
            ),
         ]);
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain("save");
      });

      it("rejects a function parameter and writes nothing", async () => {
         // Regression for T19: Electron threw 'An object could not be cloned' when it was called.
         vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await expect(run(schema("(cb: () => void) => Promise<void>"))).rejects.toThrowError(
            /Channel 'save': parameter 'cb' contains a function \('\(\) => void'\)/,
         );

         await expect(fsp.stat(path.join(dir, "out/main.ts"))).rejects.toMatchObject({
            code: "ENOENT",
         });
      });

      it("warns about nothing for plain data", async () => {
         const warn = vi.spyOn(logger, "cloneWarnings").mockImplementation(() => undefined);

         await run(schema("(id: number, tags: string[]) => Promise<{ name: string }>"));

         expect(warn.mock.calls[0][0]).toStrictEqual([]);
      });
   });
});
