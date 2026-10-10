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
import cfg from "@src/config.js";
import utils from "@src/utils.js";
import { mockFspReadFile, mockResolveUserProjectPath } from "@testutils/writer/shared-mocks.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getConfigFromUserPackage", () => {
   // The manifest path comes from the working directory, which may have no package.json.
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   it("should not throw errors when user package lacks autoipc config", async () => {
      let config: t.IPCOptionalConfig;

      mockFspReadFile({});
      config = await cfg.getConfigFromUserPackage();
      expect(config).toStrictEqual({});
      vi.restoreAllMocks();

      mockResolveUserProjectPath();
      mockFspReadFile({ config: {} });
      config = await cfg.getConfigFromUserPackage();
      expect(config).toStrictEqual({});
   });

   it("should return valid IpcOptionalConfig objects", async () => {
      const optionalConfig = {
         projectUsesNodeNext: true,
         ipcDataDir: "src/subpath/autoipc",
         codeIndent: 4,
      };
      mockFspReadFile({ config: { autoipc: optionalConfig } });
      const config = await cfg.getConfigFromUserPackage();
      expect(config).toMatchObject(optionalConfig);
   });
});

describe("getConfigFromUserPackage with a manifest that is not valid JSON", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   it("names the manifest in the error", async () => {
      // The error used to be the bare message of `JSON.parse`, which names no file.
      vi.spyOn(fsp, "readFile").mockResolvedValue('{ "name": "broken", }' as never);
      const resolved = utils.resolveUserProjectPath("package.json");

      await expect(cfg.getConfigFromUserPackage()).rejects.toThrowError(
         `Cannot parse '${resolved}': it is not valid JSON.`,
      );
   });

   it("keeps the reason of the parse error", async () => {
      vi.spyOn(fsp, "readFile").mockResolvedValue("" as never);

      await expect(cfg.getConfigFromUserPackage()).rejects.toThrowError(/package\.json'.*JSON/s);
   });
});

describe("getConfigFromUserPackage with a manifest of the wrong shape", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   // These used to fall through to the validation of the config, with a message
   // that names neither the manifest nor the entry.
   it.each([
      ["null", null, "null"],
      ["an array", [], "an array"],
      ["a string", "app", "of type string"],
      ["a number", 5, "of type number"],
   ])("names the manifest when it holds %s", async (_label, data, described) => {
      mockFspReadFile(data);
      const resolved = utils.resolveUserProjectPath("package.json");

      await expect(cfg.getConfigFromUserPackage()).rejects.toThrowError(
         `Cannot read '${resolved}': the manifest must hold a JSON object, but it holds ${described}.`,
      );
   });

   it.each([
      ["null", null, "null"],
      ["an array", [], "an array"],
      ["a string", "x", "of type string"],
      ["a boolean", false, "of type boolean"],
   ])("names the 'config' entry when it is %s", async (_label, value, described) => {
      mockFspReadFile({ config: value });

      await expect(cfg.getConfigFromUserPackage()).rejects.toThrowError(
         `'config' must be an object, but it is ${described}.`,
      );
   });

   it.each([
      ["null", null, "null"],
      ["an array", [], "an array"],
      ["a string", "src/ipc", "of type string"],
      ["zero", 0, "of type number"],
      ["false", false, "of type boolean"],
      ["an empty string", "", "of type string"],
   ])("names the 'config.autoipc' entry when it is %s", async (_label, value, described) => {
      mockFspReadFile({ config: { autoipc: value } });
      const resolved = utils.resolveUserProjectPath("package.json");

      await expect(cfg.getConfigFromUserPackage()).rejects.toThrowError(
         `Cannot read '${resolved}': 'config.autoipc' must be an object, but it is ${described}.`,
      );
   });

   it("fails the resolution of the config with that message", async () => {
      mockFspReadFile({ config: { autoipc: "src/ipc" } });

      await expect(cfg.getResolvedConfig()).rejects.toThrowError(
         /'config\.autoipc' must be an object/,
      );
   });

   it("accepts an empty autoipc object and a config without autoipc", async () => {
      mockFspReadFile({ config: { autoipc: {} } });
      await expect(cfg.getConfigFromUserPackage()).resolves.toStrictEqual({});
      vi.restoreAllMocks();

      mockResolveUserProjectPath();
      mockFspReadFile({ name: "app", config: { other: 1 } });
      await expect(cfg.getConfigFromUserPackage()).resolves.toStrictEqual({});
   });
});
