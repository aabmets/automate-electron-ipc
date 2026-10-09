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

import cfg from "@src/config.js";
import { withConfigProject } from "@testutils/config/config-project.js";
import { describe, expect, it } from "vitest";

describe("config file", () => {
   const project = withConfigProject();

   it("reads autoipc.config.json", async () => {
      await project.write({
         "autoipc.config.json": '{ "ipcDataDir": "ipc-json", "codeIndent": 4 }',
      });
      const config = await cfg.getResolvedConfig(project.dir);
      expect(config).toMatchObject({ ipcDataDir: "ipc-json", codeIndent: 4 });
   });

   it("reads autoipc.config.mjs", async () => {
      await project.write({ "autoipc.config.mjs": 'export default { ipcDataDir: "ipc-mjs" };' });
      const config = await cfg.getResolvedConfig(project.dir);
      expect(config.ipcDataDir).toBe("ipc-mjs");
      expect(config.projectRoot).toBe(project.root);
   });

   it("reads autoipc.config.ts and transpiles its types", async () => {
      await project.write({
         "autoipc.config.ts": [
            "interface Options { ipcDataDir: string; codeIndent: 2 | 3 | 4 }",
            'const options: Options = { ipcDataDir: "ipc-ts", codeIndent: 2 };',
            "export default options;",
         ].join("\n"),
      });
      const config = await cfg.getResolvedConfig(project.dir);
      expect(config).toMatchObject({ ipcDataDir: "ipc-ts", codeIndent: 2 });
   });

   it("calls a function as the default export", async () => {
      await project.write({
         "autoipc.config.mjs": 'export default () => ({ ipcDataDir: "ipc-fn" });',
      });
      expect((await cfg.getResolvedConfig(project.dir)).ipcDataDir).toBe("ipc-fn");
   });

   it("awaits an async function as the default export", async () => {
      await project.write({
         "autoipc.config.ts":
            'export default async (): Promise<object> => ({ ipcDataDir: "ipc-async" });',
      });
      expect((await cfg.getResolvedConfig(project.dir)).ipcDataDir).toBe("ipc-async");
   });

   it("reads a file again after it changed", async () => {
      await project.write({ "autoipc.config.mjs": 'export default { ipcDataDir: "first" };' });
      expect((await cfg.getResolvedConfig(project.dir)).ipcDataDir).toBe("first");
      await project.write({ "autoipc.config.mjs": 'export default { ipcDataDir: "second" };' });
      expect((await cfg.getResolvedConfig(project.dir)).ipcDataDir).toBe("second");
   });

   it("looks for the file in the project root, not in the cwd", async () => {
      await project.write({
         "autoipc.config.json": '{ "ipcDataDir": "from-root" }',
         "packages/app/placeholder.txt": "",
      });
      const config = await cfg.getResolvedConfig(`${project.dir}/packages/app`);
      expect(config.ipcDataDir).toBe("from-root");
   });

   it("accepts an empty package.json#config.autoipc next to a config file", async () => {
      await project.write(
         { "autoipc.config.json": '{ "ipcDataDir": "ipc-json" }' },
         { name: "project", config: { autoipc: {} } },
      );
      expect((await cfg.getResolvedConfig(project.dir)).ipcDataDir).toBe("ipc-json");
   });
});

describe("config file errors", () => {
   const project = withConfigProject();

   it("rejects two config files and names both", async () => {
      await project.write({
         "autoipc.config.json": "{}",
         "autoipc.config.ts": "export default {};",
      });
      const error = await cfg.getResolvedConfig(project.dir).catch((e: Error) => e);
      expect(String((error as Error).message)).toBe(
         `The project has more than one config file: '${project.root}/autoipc.config.json' and ` +
            `'${project.root}/autoipc.config.ts'. Keep one.`,
      );
   });

   it("rejects a config file and package.json#config.autoipc", async () => {
      await project.write(
         { "autoipc.config.json": "{}" },
         { name: "project", config: { autoipc: { codeIndent: 4 } } },
      );
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "The config is set in both 'autoipc.config.json' and 'package.json#config.autoipc'; keep one.",
      );
   });

   it("names the file when it is not valid JSON", async () => {
      await project.write({ "autoipc.config.json": "{ oops" });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "Cannot load the config file 'autoipc.config.json':",
      );
   });

   it("names the file when it throws", async () => {
      await project.write({ "autoipc.config.mjs": 'throw new Error("boom");' });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "Cannot load the config file 'autoipc.config.mjs': boom",
      );
   });

   it("names a thrown value that is not an error", async () => {
      await project.write({ "autoipc.config.mjs": 'throw "plain";' });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "Cannot load the config file 'autoipc.config.mjs': plain",
      );
   });

   it.each([
      ["null", "null"],
      ["an array", "[]"],
      ["a number", "3"],
   ])("rejects a config that is %s", async (_label, text) => {
      await project.write({ "autoipc.config.json": text });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "The config file 'autoipc.config.json' must give an object as its config.",
      );
   });
});

describe("config file temp file", () => {
   const project = withConfigProject();

   it("is deleted after the config was read", async () => {
      await project.write({ "autoipc.config.ts": 'export default { ipcDataDir: "ipc-ts" };' });
      await cfg.getResolvedConfig(project.dir);
      expect(await project.list()).toStrictEqual(["autoipc.config.ts", "package.json"]);
   });

   it("is deleted after the config threw", async () => {
      await project.write({ "autoipc.config.ts": 'throw new Error("boom");' });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(/boom/);
      expect(await project.list()).toStrictEqual(["autoipc.config.ts", "package.json"]);
   });

   it("is deleted after the config has a syntax error", async () => {
      await project.write({ "autoipc.config.ts": "export default {" });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         "Cannot load the config file 'autoipc.config.ts':",
      );
      expect(await project.list()).toStrictEqual(["autoipc.config.ts", "package.json"]);
   });
});
