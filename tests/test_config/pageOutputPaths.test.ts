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
import {
   mockFspReadFile,
   mockFspStatsByPath,
   mockResolveUserProjectPath,
} from "@testutils/writer/shared-mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = "/home/user/project";

describe("getResolvedConfig, paths of the main, preload and renderer files", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   const resolve = async (autoipc: Record<string, unknown>) => {
      mockFspStatsByPath({});
      mockFspReadFile({ config: { autoipc } });
      return await cfg.getResolvedConfig();
   };

   it("puts the three files in the data directory unless the config says otherwise", async () => {
      const config = await resolve({ ipcDataDir: "src/ipc" });
      expect(config.mainBindingsFilePath).toBe(`${ROOT}/src/ipc/main.ts`);
      expect(config.preloadBindingsFilePath).toBe(`${ROOT}/src/ipc/preload.ts`);
      expect(config.rendererTypesFilePath).toBe(`${ROOT}/src/ipc/window.d.ts`);
   });

   it("resolves each path from the project root, and keeps the other two where they are", async () => {
      const config = await resolve({
         ipcDataDir: "src/ipc",
         mainBindingsPath: "src/main/gen/ipc.ts",
         preloadBindingsPath: "src/preload/gen/ipc.ts",
         rendererTypesPath: "types/ipc.d.ts",
      });
      expect(config.mainBindingsFilePath).toBe(`${ROOT}/src/main/gen/ipc.ts`);
      expect(config.preloadBindingsFilePath).toBe(`${ROOT}/src/preload/gen/ipc.ts`);
      expect(config.rendererTypesFilePath).toBe(`${ROOT}/types/ipc.d.ts`);

      const moved = await resolve({ mainBindingsPath: "gen/main.ts" });
      expect(moved.mainBindingsFilePath).toBe(`${ROOT}/gen/main.ts`);
      expect(moved.preloadBindingsFilePath).toBe(`${ROOT}/src/autoipc/preload.ts`);
      expect(moved.rendererTypesFilePath).toBe(`${ROOT}/src/autoipc/window.d.ts`);
   });

   it.each([
      ["mainBindingsPath", "gen/main.js"],
      ["preloadBindingsPath", "gen/preload.d.ts"],
      ["rendererTypesPath", "gen/window.ts"],
   ])("refuses %s: %s, since the extension is wrong", async (option, value) => {
      await expect(resolve({ [option]: value })).rejects.toThrowError(
         new RegExp(`Invalid config in package.json#config.autoipc: .*${option} must be the path`),
      );
   });

   it.each([
      ["mainBindingsPath", "src/autoipc/preload.ts"],
      ["mainBindingsPath", "src/autoipc/utility.ts"],
      ["preloadBindingsPath", "src/autoipc/main.ts"],
      ["preloadBindingsPath", "src/autoipc/service-worker-preload.ts"],
   ])("refuses %s: %s, since it is the path of another generated file", async (option, value) => {
      await expect(resolve({ [option]: value })).rejects.toThrowError(
         `The config '${option}' ('${value}') is the path of another generated file.`,
      );
   });

   it("refuses the typings of the service worker as the typings of the page", async () => {
      await expect(
         resolve({ rendererTypesPath: "src/autoipc/service-worker.d.ts" }),
      ).rejects.toThrowError(/'rendererTypesPath' .* is the path of another generated file/);
      await expect(
         resolve({
            serviceWorkerPreloadPath: "src/sw/preload.ts",
            rendererTypesPath: "src/sw/service-worker.d.ts",
         }),
      ).rejects.toThrowError(/'rendererTypesPath' .* is the path of another generated file/);
   });

   it("refuses two options that name the same file, and blames the later one", async () => {
      await expect(
         resolve({ mainBindingsPath: "gen/ipc.ts", preloadBindingsPath: "gen/ipc.ts" }),
      ).rejects.toThrowError(/'preloadBindingsPath' .* is the path of another generated file/);
      await expect(
         resolve({ mainBindingsPath: "gen/ipc.ts", utilityBindingsPath: "gen/ipc.ts" }),
      ).rejects.toThrowError(/'utilityBindingsPath' .* is the path of another generated file/);
   });

   it("refuses a default path that another option takes, wherever the data directory is", async () => {
      await expect(
         resolve({ ipcDataDir: "ipc", preloadBindingsPath: "ipc/main.ts" }),
      ).rejects.toThrowError("is the path of another generated file");
   });

   it("accepts a file that takes the place of the default one", async () => {
      const config = await resolve({
         mainBindingsPath: "src/autoipc/preload.ts",
         preloadBindingsPath: "src/autoipc/main.ts",
      });
      expect(config.mainBindingsFilePath).toBe(`${ROOT}/src/autoipc/preload.ts`);
      expect(config.preloadBindingsFilePath).toBe(`${ROOT}/src/autoipc/main.ts`);
   });

   it.each([
      ["mainBindingsPath", "src/autoipc/schema.ts"],
      ["preloadBindingsPath", "src/autoipc/schema.ts"],
      ["mainBindingsPath", "src/autoipc/./schema.ts"],
   ])("refuses %s: %s, since it is the schema file", async (option, value) => {
      await expect(resolve({ [option]: value })).rejects.toThrowError(
         `The config '${option}' ('${value}') is the schema file, which the run would overwrite.`,
      );
   });

   it("refuses a file in the schema directory, but not the typings", async () => {
      mockFspStatsByPath({ [`${ROOT}/src/autoipc/schema`]: "directory" });
      mockFspReadFile({ config: { autoipc: { preloadBindingsPath: "src/autoipc/schema/p.ts" } } });
      await expect(cfg.getResolvedConfig()).rejects.toThrowError(/is a schema file/);

      mockFspReadFile({ config: { autoipc: { rendererTypesPath: "src/autoipc/schema/w.d.ts" } } });
      const config = await cfg.getResolvedConfig();
      expect(config.rendererTypesFilePath).toBe(`${ROOT}/src/autoipc/schema/w.d.ts`);
   });

   it("refuses the serializer module", async () => {
      await expect(
         resolve({ serializer: "./src/autoipc/wire", mainBindingsPath: "src/autoipc/wire.ts" }),
      ).rejects.toThrowError(
         "The config 'mainBindingsPath' ('src/autoipc/wire.ts') is the serializer module, which the run would overwrite.",
      );
   });
});
