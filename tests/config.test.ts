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
         mainBindingsFilePath: `${DEFAULT_DIR}/main.ts`,
         preloadBindingsFilePath: `${DEFAULT_DIR}/preload.ts`,
         rendererTypesFilePath: `${DEFAULT_DIR}/window.d.ts`,
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
      mocks.mockFspStatsByPath({ [`${dir}/schema`]: "directory" });
      mocks.mockFspReadFile({
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
         mainBindingsFilePath: `${dir}/main.ts`,
         preloadBindingsFilePath: `${dir}/preload.ts`,
         rendererTypesFilePath: `${dir}/window.d.ts`,
         ipcSchema: {
            path: `${dir}/schema`,
         },
      });
   });

   describe("exposure of the API", () => {
      const resolve = async (autoipc: Record<string, unknown>) => {
         mocks.mockFspStatsByPath({});
         mocks.mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it.each(["name", "my-app", "Promise"])("refuses the key '%s'", async (exposeAs) => {
         await expect(resolve({ exposeAs })).rejects.toThrowError(/exposeAs/);
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
         mocks.mockFspStatsByPath({});
         mocks.mockFspReadFile({ config: { autoipc } });
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

   describe("path of the utility bindings", () => {
      const resolve = async (autoipc: Record<string, unknown>) => {
         mocks.mockFspStatsByPath({});
         mocks.mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it("is next to the other generated files unless the config says otherwise", async () => {
         const config = await resolve({ ipcDataDir: "src/ipc" });
         expect(config.utilityBindingsFilePath).toBe("/home/user/project/src/ipc/utility.ts");
      });

      it("is resolved from the project root", async () => {
         const config = await resolve({ utilityBindingsPath: "src/worker/generated/ipc.ts" });
         expect(config.utilityBindingsFilePath).toBe(
            "/home/user/project/src/worker/generated/ipc.ts",
         );
      });

      it.each(["main.ts", "preload.ts"])(
         "refuses the path of the generated file %s",
         async (name) => {
            const path = `src/autoipc/${name}`;
            await expect(resolve({ utilityBindingsPath: path })).rejects.toThrowError(
               `The config 'utilityBindingsPath' ('${path}') is the path of another generated file.`,
            );
         },
      );
   });

   describe("paths of the service worker files", () => {
      const resolve = async (autoipc: Record<string, unknown>) => {
         mocks.mockFspStatsByPath({});
         mocks.mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it("are next to the other generated files unless the config says otherwise", async () => {
         const config = await resolve({ ipcDataDir: "src/ipc" });
         expect(config.serviceWorkerPreloadFilePath).toBe(
            "/home/user/project/src/ipc/service-worker-preload.ts",
         );
         expect(config.serviceWorkerTypesFilePath).toBe(
            "/home/user/project/src/ipc/service-worker.d.ts",
         );
      });

      it("put the typings next to the preload script that the config names", async () => {
         const config = await resolve({ serviceWorkerPreloadPath: "src/sw/generated/preload.ts" });
         expect(config.serviceWorkerPreloadFilePath).toBe(
            "/home/user/project/src/sw/generated/preload.ts",
         );
         expect(config.serviceWorkerTypesFilePath).toBe(
            "/home/user/project/src/sw/generated/service-worker.d.ts",
         );
      });

      it.each(["main.ts", "preload.ts", "utility.ts"])(
         "refuse the path of the generated file %s for the preload script",
         async (name) => {
            const path = `src/autoipc/${name}`;
            await expect(resolve({ serviceWorkerPreloadPath: path })).rejects.toThrowError(
               `The config 'serviceWorkerPreloadPath' ('${path}') is the path of another generated file.`,
            );
         },
      );

      it("refuse the path of the utility bindings, wherever the config puts them", async () => {
         await expect(
            resolve({
               utilityBindingsPath: "src/sw/utility.ts",
               serviceWorkerPreloadPath: "src/sw/utility.ts",
            }),
         ).rejects.toThrowError(
            /'serviceWorkerPreloadPath' .* is the path of another generated file/,
         );
      });
   });

   describe("output paths that are inputs of the run", () => {
      const DIR = "/home/user/project/src/autoipc";
      const resolve = async (
         autoipc: Record<string, unknown>,
         entries: Record<string, "directory" | "file"> = {},
      ) => {
         mocks.mockFspStatsByPath(entries);
         mocks.mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it.each([
         ["utilityBindingsPath", false],
         ["utilityBindingsPath", true],
         ["serviceWorkerPreloadPath", false],
         ["serviceWorkerPreloadPath", true],
      ])("refuses the schema file for %s (the file exists: %s)", async (option, exists) => {
         const entries = exists ? { [`${DIR}/schema.ts`]: "file" as const } : {};
         await expect(resolve({ [option]: "src/autoipc/schema.ts" }, entries)).rejects.toThrowError(
            `The config '${option}' ('src/autoipc/schema.ts') is the schema file, which the run would overwrite.`,
         );
      });

      it("refuses the schema file under another spelling of the same path", async () => {
         await expect(
            resolve({ utilityBindingsPath: "src/autoipc/../autoipc/./schema.ts" }),
         ).rejects.toThrowError(/is the schema file/);
      });

      it("refuses the schema file of a custom data directory", async () => {
         await expect(
            resolve({ ipcDataDir: "ipc", serviceWorkerPreloadPath: "ipc/schema.ts" }),
         ).rejects.toThrowError(/'serviceWorkerPreloadPath' .* is the schema file/);
      });

      it.each([
         ["utilityBindingsPath", "a.ts"],
         ["utilityBindingsPath", "nested/b.mts"],
         ["serviceWorkerPreloadPath", "nested/deep/c.cts"],
      ])(
         "refuses a schema source file under the schema directory for %s: %s",
         async (option, file) => {
            await expect(
               resolve(
                  { [option]: `src/autoipc/schema/${file}` },
                  { [`${DIR}/schema`]: "directory" },
               ),
            ).rejects.toThrowError(/is a schema file, which the run would overwrite/);
         },
      );

      it("refuses the schema file path while the schema directory is the schema", async () => {
         // The file would then take over from the directory on the next run.
         await expect(
            resolve(
               { utilityBindingsPath: "src/autoipc/schema.ts" },
               { [`${DIR}/schema`]: "directory" },
            ),
         ).rejects.toThrowError(/is the schema file/);
      });

      it("accepts a path under the schema directory when the schema file is the schema", async () => {
         const config = await resolve(
            { utilityBindingsPath: "src/autoipc/schema/out.ts" },
            { [`${DIR}/schema`]: "directory", [`${DIR}/schema.ts`]: "file" },
         );
         expect(config.utilityBindingsFilePath).toBe(`${DIR}/schema/out.ts`);
      });

      it("accepts a path beside the schema file and the schema directory", async () => {
         const config = await resolve(
            {
               utilityBindingsPath: "src/autoipc/schema-utility.ts",
               serviceWorkerPreloadPath: "src/autoipc/schemas/sw.ts",
            },
            { [`${DIR}/schema`]: "directory" },
         );
         expect(config.utilityBindingsFilePath).toBe(`${DIR}/schema-utility.ts`);
         expect(config.serviceWorkerPreloadFilePath).toBe(`${DIR}/schemas/sw.ts`);
      });

      describe("serializer module", () => {
         it.each([
            ["./src/autoipc/serializer", "src/autoipc/serializer.ts"],
            ["./src/autoipc/serializer", "src/autoipc/serializer.mts"],
            ["./src/autoipc/serializer", "src/autoipc/serializer/index.ts"],
            ["./src/autoipc/serializer.ts", "src/autoipc/serializer.ts"],
            ["./src/autoipc/serializer.js", "src/autoipc/serializer.ts"],
            ["./src/autoipc/serializer.mjs", "src/autoipc/serializer.mts"],
            ["./src/autoipc/serializer.cjs", "src/autoipc/serializer.cts"],
            ["./src/../src/autoipc/serializer.js", "src/autoipc/serializer.ts"],
         ])("refuses the serializer %s as the path %s", async (serializer, output) => {
            await expect(resolve({ serializer, utilityBindingsPath: output })).rejects.toThrowError(
               `The config 'utilityBindingsPath' ('${output}') is the serializer module, which the run would overwrite.`,
            );
            await expect(
               resolve({ serializer, serviceWorkerPreloadPath: output }),
            ).rejects.toThrowError(/'serviceWorkerPreloadPath' .* is the serializer module/);
         });

         it.each([
            ["./src/autoipc/serializer.js", "src/autoipc/serializer.mts"],
            ["./src/autoipc/serializer", "src/autoipc/serializer-utility.ts"],
            ["./src/autoipc/serializer", "src/autoipc/other/serializer.ts"],
            ["superjson", "superjson.ts"],
            ["superjson", "node_modules/superjson/index.ts"],
         ])("accepts the serializer %s and the path %s", async (serializer, output) => {
            const config = await resolve({ serializer, utilityBindingsPath: output });
            expect(config.utilityBindingsFilePath).toBe(`/home/user/project/${output}`);
         });
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
