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
import utils from "@src/utils.js";
import mocks from "@testutils/shared-mocks.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getConfigFromUserPackage", () => {
   // The manifest path comes from the working directory, which may have no package.json.
   beforeEach(mocks.mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   it("should not throw errors when user package lacks autoipc config", async () => {
      let config: t.IPCOptionalConfig;

      mocks.mockFspReadFile({});
      config = await cfg.getConfigFromUserPackage();
      expect(config).toStrictEqual({});
      vi.restoreAllMocks();

      mocks.mockResolveUserProjectPath();
      mocks.mockFspReadFile({ config: {} });
      config = await cfg.getConfigFromUserPackage();
      expect(config).toStrictEqual({});
   });

   it("should return valid IpcOptionalConfig objects", async () => {
      const optionalConfig = {
         projectUsesNodeNext: true,
         ipcDataDir: "src/subpath/autoipc",
         codeIndent: 4,
      };
      mocks.mockFspReadFile({ config: { autoipc: optionalConfig } });
      const config = await cfg.getConfigFromUserPackage();
      expect(config).toMatchObject(optionalConfig);
   });
});

describe("getResolvedConfig", () => {
   beforeEach(mocks.mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   it("should resolve the manifest and the data dir from the given cwd", async () => {
      // Regression for T07: the project root was found from the library install location.
      mocks.mockFspStatsByPath({});
      mocks.mockFspReadFile({ config: { autoipc: { ipcDataDir: "ipc" } } });
      const resolve = vi.spyOn(utils, "resolveUserProjectPath");
      await cfg.getResolvedConfig("/home/user/workspace/packages/app");
      expect(resolve).toHaveBeenCalledWith("package.json", "/home/user/workspace/packages/app");
      expect(resolve).toHaveBeenCalledWith("ipc", "/home/user/workspace/packages/app");
   });

   const DEFAULT_DIR = "/home/user/project/src/autoipc";

   it("should resolve missing optional config to expected default config", async () => {
      mocks.mockFspStatsByPath({ [`${DEFAULT_DIR}/schema.ts`]: "file" });
      mocks.mockFspReadFile({ config: {} });
      const config = await cfg.getResolvedConfig();

      expect(config?.ipcSchema?.stats?.isDirectory()).toStrictEqual(false);
      expect(config?.ipcSchema?.stats?.isFile()).toStrictEqual(true);
      expect(config).toMatchObject({
         projectRoot: "/home/user/project",
         projectUsesNodeNext: false,
         ipcDataDir: "src/autoipc",
         codeIndent: 3,
         rawErrors: false,
         mainBindingsFilePath: `${DEFAULT_DIR}/main.ts`,
         preloadBindingsFilePath: `${DEFAULT_DIR}/preload.ts`,
         rendererTypesFilePath: `${DEFAULT_DIR}/window.d.ts`,
         ipcSchema: {
            path: `${DEFAULT_DIR}/schema.ts`,
         },
      });
   });

   it("should resolve optional config to expected config", async () => {
      const dir = "/home/user/project/src/subpath/autoipc";
      mocks.mockFspStatsByPath({ [`${dir}/schema`]: "directory" });
      mocks.mockFspReadFile({
         config: {
            autoipc: {
               projectUsesNodeNext: true,
               ipcDataDir: "src/subpath/autoipc",
               codeIndent: 4,
               rawErrors: true,
            },
         },
      });
      const config = await cfg.getResolvedConfig();

      expect(config?.ipcSchema?.stats?.isDirectory()).toStrictEqual(true);
      expect(config?.ipcSchema?.stats?.isFile()).toStrictEqual(false);
      expect(config).toMatchObject({
         projectUsesNodeNext: true,
         ipcDataDir: "src/subpath/autoipc",
         codeIndent: 4,
         rawErrors: true,
         mainBindingsFilePath: `${dir}/main.ts`,
         preloadBindingsFilePath: `${dir}/preload.ts`,
         rendererTypesFilePath: `${dir}/window.d.ts`,
         ipcSchema: {
            path: `${dir}/schema`,
         },
      });
   });

   describe("choice of the schema path", () => {
      const resolve = async (entries: Record<string, "directory" | "file">) => {
         mocks.mockFspStatsByPath(entries);
         mocks.mockFspReadFile({ config: {} });
         return (await cfg.getResolvedConfig()).ipcSchema;
      };

      it("uses the schema directory when only the directory exists", async () => {
         const schema = await resolve({ [`${DEFAULT_DIR}/schema`]: "directory" });
         expect(schema.path).toBe(`${DEFAULT_DIR}/schema`);
         expect(schema.stats?.isDirectory()).toBe(true);
      });

      it("uses the schema file when only the file exists", async () => {
         const schema = await resolve({ [`${DEFAULT_DIR}/schema.ts`]: "file" });
         expect(schema.path).toBe(`${DEFAULT_DIR}/schema.ts`);
         expect(schema.stats?.isFile()).toBe(true);
      });

      it("prefers the schema file when both exist", async () => {
         const schema = await resolve({
            [`${DEFAULT_DIR}/schema`]: "directory",
            [`${DEFAULT_DIR}/schema.ts`]: "file",
         });
         expect(schema.path).toBe(`${DEFAULT_DIR}/schema.ts`);
         expect(schema.stats?.isFile()).toBe(true);
      });

      it("points at the schema file without stats when neither exists", async () => {
         const schema = await resolve({});
         expect(schema.path).toBe(`${DEFAULT_DIR}/schema.ts`);
         expect(schema.stats).toBeNull();
      });
   });
});
