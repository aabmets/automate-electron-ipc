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
import {
   mockFspReadFile,
   mockFspStatsByPath,
   mockResolveUserProjectPath,
} from "@testutils/writer/shared-mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getResolvedConfig", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   it("should resolve the manifest and the data dir from the given cwd", async () => {
      // Regression for T07: the project root was found from the library install location.
      mockFspStatsByPath({});
      mockFspReadFile({ config: { autoipc: { ipcDataDir: "ipc" } } });
      const resolve = vi.spyOn(utils, "resolveUserProjectPath");
      await cfg.getResolvedConfig("/home/user/workspace/packages/app");
      expect(resolve).toHaveBeenCalledWith("package.json", "/home/user/workspace/packages/app");
      expect(resolve).toHaveBeenCalledWith("ipc", "/home/user/workspace/packages/app");
   });

   const DEFAULT_DIR = "/home/user/project/src/autoipc";

   it("should resolve missing optional config to expected default config", async () => {
      mockFspStatsByPath({ [`${DEFAULT_DIR}/schema.ts`]: "file" });
      mockFspReadFile({ config: {} });
      const config = await cfg.getResolvedConfig();

      expect(config?.ipcSchema?.stats?.isDirectory()).toStrictEqual(false);
      expect(config?.ipcSchema?.stats?.isFile()).toStrictEqual(true);
      expect(config.isolatedWorldId).toBeUndefined();
      expect(config).toMatchObject({
         projectRoot: "/home/user/project",
         projectUsesNodeNext: false,
         ipcDataDir: "src/autoipc",
         codeIndent: 3,
         rawErrors: false,
         channelPrefix: "autoipc:",
         timeoutMs: 0,
         exposeAs: "ipc",
         autoExpose: true,
         getPathForFile: false,
         format: false,
         mainBindingsFilePath: `${DEFAULT_DIR}/main.ts`,
         preloadBindingsFilePath: `${DEFAULT_DIR}/preload.ts`,
         rendererTypesFilePath: `${DEFAULT_DIR}/window.d.ts`,
         typesFilePath: `${DEFAULT_DIR}/types.ts`,
         utilityBindingsFilePath: `${DEFAULT_DIR}/utility.ts`,
         serviceWorkerPreloadFilePath: `${DEFAULT_DIR}/service-worker-preload.ts`,
         serviceWorkerTypesFilePath: `${DEFAULT_DIR}/service-worker.d.ts`,
         ipcSchema: {
            path: `${DEFAULT_DIR}/schema.ts`,
         },
      });
   });

   it("should resolve optional config to expected config", async () => {
      const dir = "/home/user/project/src/subpath/autoipc";
      mockFspStatsByPath({ [`${dir}/schema`]: "directory" });
      mockFspReadFile({
         config: {
            autoipc: {
               projectUsesNodeNext: true,
               ipcDataDir: "src/subpath/autoipc",
               codeIndent: 4,
               rawErrors: true,
               channelPrefix: "",
               timeoutMs: 15000,
               exposeAs: "api",
               isolatedWorldId: 1004,
               autoExpose: false,
               getPathForFile: true,
               format: "prettier",
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
         channelPrefix: "",
         timeoutMs: 15000,
         exposeAs: "api",
         isolatedWorldId: 1004,
         autoExpose: false,
         getPathForFile: true,
         format: "prettier",
         mainBindingsFilePath: `${dir}/main.ts`,
         preloadBindingsFilePath: `${dir}/preload.ts`,
         rendererTypesFilePath: `${dir}/window.d.ts`,
         typesFilePath: `${dir}/types.ts`,
         ipcSchema: {
            path: `${dir}/schema`,
         },
      });
   });

   describe("exposure of the API", () => {
      const resolve = async (autoipc: Record<string, unknown>) => {
         mockFspStatsByPath({});
         mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it.each(["name", "my-app", "Promise"])("refuses the key '%s'", async (exposeAs) => {
         await expect(resolve({ exposeAs })).rejects.toThrowError(/exposeAs/);
      });

      it.each(["yes", true, "Biome", null])("refuses the format %j", async (format) => {
         await expect(resolve({ format })).rejects.toThrowError(
            /format must be 'biome', 'prettier' or false/,
         );
      });

      it.each(["yes", 1])("refuses the getPathForFile %j", async (getPathForFile) => {
         await expect(resolve({ getPathForFile })).rejects.toThrowError(/getPathForFile/);
      });

      it.each(["no", 0])("refuses the autoExpose %j", async (autoExpose) => {
         await expect(resolve({ autoExpose })).rejects.toThrowError(/autoExpose/);
      });

      it.each([999, 0, 1000.5])("refuses the world %d", async (isolatedWorldId) => {
         await expect(resolve({ isolatedWorldId })).rejects.toThrowError(/isolatedWorldId/);
      });
   });

   describe("serializer", () => {
      const resolve = async (autoipc: Record<string, unknown>) => {
         mockFspStatsByPath({});
         mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it("is off unless the config names a module", async () => {
         const config = await resolve({});
         expect(config.serializer).toBeUndefined();
         expect(config.serializerFilePath).toBeUndefined();
      });

      it("keeps the name of a package as it is, and resolves no file", async () => {
         const config = await resolve({ serializer: "superjson" });
         expect(config.serializer).toBe("superjson");
         expect(config.serializerFilePath).toBeUndefined();
      });

      it("resolves a path from the project root", async () => {
         const config = await resolve({ serializer: "./src/lib/wire.ts" });
         expect(config.serializer).toBe("./src/lib/wire.ts");
         expect(config.serializerFilePath).toBe("/home/user/project/src/lib/wire.ts");
      });

      it("refuses a value that is neither a package nor a path in the project", async () => {
         await expect(resolve({ serializer: "/etc/wire.ts" })).rejects.toThrowError(/serializer/);
         await expect(resolve({ serializer: 5 })).rejects.toThrowError(/serializer/);
      });
   });

   describe("choice of the schema path", () => {
      const resolve = async (entries: Record<string, "directory" | "file">) => {
         mockFspStatsByPath(entries);
         mockFspReadFile({ config: {} });
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
