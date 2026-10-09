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
import cfg from "@src/config.js";
import { withConfigProject } from "@testutils/config/config-project.js";
import { describe, expect, it } from "vitest";

describe("the config option of a run", () => {
   const project = withConfigProject();

   it("reads the file that the option names, relative to the cwd", async () => {
      await project.write({
         "configs/custom.json": '{ "ipcDataDir": "ipc-custom" }',
         "packages/app/placeholder.txt": "",
      });
      const config = await cfg.getResolvedConfig({
         cwd: `${project.dir}/packages/app`,
         configFile: "../../configs/custom.json",
      });
      expect(config.ipcDataDir).toBe("ipc-custom");
   });

   it("reads an absolute path, which may be outside the project", async () => {
      const outside = path.join(
         path.dirname(project.dir),
         `outside-${path.basename(project.dir)}.json`,
      );
      await project.write({});
      await fsp.writeFile(outside, '{ "ipcDataDir": "ipc-outside" }');
      try {
         const config = await cfg.getResolvedConfig({ cwd: project.dir, configFile: outside });
         expect(config.ipcDataDir).toBe("ipc-outside");
         await project.write({}, { name: "project", config: { autoipc: { codeIndent: 4 } } });
         await expect(
            cfg.getResolvedConfig({ cwd: project.dir, configFile: outside }),
         ).rejects.toThrowError(`The config is set in both '${outside.replaceAll("\\", "/")}'`);
      } finally {
         await fsp.rm(outside, { force: true });
      }
   });

   it("takes the named file although the root holds two config files", async () => {
      await project.write({
         "autoipc.config.json": "{}",
         "autoipc.config.mjs": "export default {};",
         "chosen.mjs": 'export default { ipcDataDir: "ipc-chosen" };',
      });
      const config = await cfg.getResolvedConfig({ cwd: project.dir, configFile: "chosen.mjs" });
      expect(config.ipcDataDir).toBe("ipc-chosen");
   });

   it("rejects a file that does not exist", async () => {
      await project.write({});
      await expect(
         cfg.getResolvedConfig({ cwd: project.dir, configFile: "missing.json" }),
      ).rejects.toThrowError(`The config file '${project.root}/missing.json' does not exist.`);
   });

   it("rejects a file of a type that cannot be read", async () => {
      await project.write({ "autoipc.yaml": "ipcDataDir: x" });
      await expect(
         cfg.getResolvedConfig({ cwd: project.dir, configFile: "autoipc.yaml" }),
      ).rejects.toThrowError("use a .json, .mjs or .ts file.");
   });
});
