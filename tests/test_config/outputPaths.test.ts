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
import mocks from "@testutils/shared-mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getResolvedConfig", () => {
   beforeEach(mocks.mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

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
});
