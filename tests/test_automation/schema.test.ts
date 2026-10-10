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
import { ipcAutomation } from "@src/automation.js";
import cfg from "@src/config.js";
import logger from "@src/logger.js";
import { GENERATED_PREFIX } from "@src/output-files.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   const automation = withAutomationDir();

   it("resolves the config from the given cwd", async () => {
      const schemaPath = path.join(automation.dir, "schema.ts");
      automation.mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);

      await ipcAutomation("/work/packages/app");

      expect(cfg.getResolvedConfig).toHaveBeenCalledWith("/work/packages/app");
   });

   it("passes the run options on to the config", async () => {
      const schemaPath = path.join(automation.dir, "schema.ts");
      automation.mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);
      const options = {
         cwd: "/work/packages/app",
         configFile: "conf/ipc.config.ts",
         overrides: { codeIndent: 4 as const },
      };

      await ipcAutomation(options);

      expect(cfg.getResolvedConfig).toHaveBeenCalledWith(options);
   });

   it("creates the schema directory and skips when the schema path does not exist", async () => {
      const schemaPath = path.join(automation.dir, "ipc/schema.ts");
      automation.mockConfig({ ipcSchema: { path: schemaPath, stats: null } } as never);
      const warn = vi.spyOn(logger, "nonExistentSchemaPath").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect((await fsp.stat(path.dirname(schemaPath))).isDirectory()).toBe(true);
      await expect(fsp.stat(path.join(automation.dir, "out/main.ts"))).rejects.toMatchObject({
         code: "ENOENT",
      });
   });

   it("writes empty bindings and warns when the schema has no channels", async () => {
      const schemaPath = path.join(automation.dir, "schema.ts");
      await fsp.writeFile(schemaPath, "export const x = 1;\n");
      automation.mockConfig({
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const warn = vi.spyOn(logger, "noChannelExpressions").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(warn).toHaveBeenCalledWith(schemaPath);
      expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).toContain(
         GENERATED_PREFIX,
      );
   });

   it("generates identical output however readdir orders files and reads complete", async () => {
      // Files were pushed in read completion order, so the order of the generated imports and
      // members changed between runs.
      const schemaDir = path.join(automation.dir, "schema");
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
      automation.mockConfig({
         ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) },
      } as never);
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
               fsp.readFile(path.join(automation.dir, "out", name), "utf8"),
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
      // A stale "src/ipc" fallback once disagreed with the "src/autoipc" default.
      const schemaPath = path.join(automation.dir, "src/autoipc/schema.ts");
      await fsp.mkdir(path.dirname(schemaPath), { recursive: true });
      await fsp.writeFile(
         schemaPath,
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({ getUser: invoke<() => Promise<string>>() });",
         ].join("\n"),
      );
      automation.mockConfig({
         ipcDataDir: "src/autoipc",
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      // The relative path names the schema file, and not its directory.
      expect(success.mock.calls[0][0].map((pfs) => pfs.relativePath)).toStrictEqual([
         "src/autoipc/schema.ts",
      ]);
   });

   it("passes the project root to the success report", async () => {
      // The report used to cut paths at the first occurrence of the data dir name.
      const schemaPath = path.join(automation.dir, "schema.ts");
      await fsp.writeFile(
         schemaPath,
         [
            'import { defineChannels, invoke } from "automate-electron-ipc";',
            "export default defineChannels({ getUser: invoke<() => Promise<string>>() });",
         ].join("\n"),
      );
      automation.mockConfig({
         projectRoot: automation.dir,
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      expect(success).toHaveBeenCalledOnce();
      expect(success.mock.calls[0][1]).toBe(automation.dir);
   });

   it("reads only .ts, .mts and .cts files, ignoring declaration files", async () => {
      const schemaDir = path.join(automation.dir, "schema");
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
      automation.mockConfig({
         ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      const reported = success.mock.calls[0][0].map((pfs) => pfs.relativePath);
      expect(reported.sort()).toStrictEqual(["a.ts", "b.mts", "c.cts"]);
   });

   it("rejects with the file position when a schema file has a syntax error", async () => {
      const schemaPath = path.join(automation.dir, "schema.ts");
      await fsp.writeFile(schemaPath, "export default defineChannels({ a: ;\n});");
      automation.mockConfig({
         ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
      } as never);

      await expect(ipcAutomation()).rejects.toThrowError(
         `Syntax error in schema file '${schemaPath}:1:36'`,
      );
      await expect(fsp.stat(path.join(automation.dir, "out/main.ts"))).rejects.toMatchObject({
         code: "ENOENT",
      });
   });

   it("skips schema directory files without channels", async () => {
      const schemaDir = path.join(automation.dir, "schema");
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
      automation.mockConfig({
         ipcSchema: { path: schemaDir, stats: await fsp.stat(schemaDir) },
      } as never);
      const success = vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

      await ipcAutomation();

      const reported = success.mock.calls[0][0];
      expect(reported.map((pfs) => pfs.relativePath)).toStrictEqual([
         path.join("nested", "user.ts"),
      ]);
      expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).toContain(
         "getUser",
      );
   });
});
