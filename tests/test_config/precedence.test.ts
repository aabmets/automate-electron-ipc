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

describe("config precedence", () => {
   const project = withConfigProject();

   it("lets the config file beat the defaults", async () => {
      await project.write({ "autoipc.config.json": '{ "codeIndent": 4 }' });
      const config = await cfg.getResolvedConfig(project.dir);
      expect(config.codeIndent).toBe(4);
      expect(config.ipcDataDir).toBe("src/autoipc");
   });

   it("lets the manifest beat the defaults when there is no config file", async () => {
      await project.write({}, { name: "project", config: { autoipc: { codeIndent: 2 } } });
      expect((await cfg.getResolvedConfig(project.dir)).codeIndent).toBe(2);
   });

   it("lets the overrides beat the config file", async () => {
      await project.write({ "autoipc.config.json": '{ "codeIndent": 4, "ipcDataDir": "ipc" }' });
      const config = await cfg.getResolvedConfig({
         cwd: project.dir,
         overrides: { codeIndent: 2 },
      });
      expect(config).toMatchObject({ codeIndent: 2, ipcDataDir: "ipc" });
   });

   it("lets the overrides beat the manifest", async () => {
      await project.write({}, { name: "project", config: { autoipc: { codeIndent: 4 } } });
      const config = await cfg.getResolvedConfig({
         cwd: project.dir,
         overrides: { codeIndent: 2 },
      });
      expect(config.codeIndent).toBe(2);
   });

   it("lets the overrides beat the defaults", async () => {
      await project.write({});
      const config = await cfg.getResolvedConfig({
         cwd: project.dir,
         overrides: { rawErrors: true },
      });
      expect(config.rawErrors).toBe(true);
   });

   it("keeps the value of an override that is undefined", async () => {
      await project.write({ "autoipc.config.json": '{ "codeIndent": 4 }' });
      const config = await cfg.getResolvedConfig({
         cwd: project.dir,
         overrides: { codeIndent: undefined },
      });
      expect(config.codeIndent).toBe(4);
   });

   it("takes a string as the cwd", async () => {
      await project.write({ "autoipc.config.json": '{ "codeIndent": 4 }' });
      expect((await cfg.getResolvedConfig(project.dir)).codeIndent).toBe(4);
   });
});
