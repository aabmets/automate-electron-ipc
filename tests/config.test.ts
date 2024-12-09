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
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mocks from "./mocks.js";

describe("getConfigFromUserPackage", () => {
   afterEach(vi.restoreAllMocks);

   it("should not throw errors when user package lacks autoipc config", async () => {
      let config: t.IPCOptionalConfig;

      mocks.mockFspReadFile({});
      config = await cfg.getConfigFromUserPackage();
      expect(config).toMatchObject({});
      vi.restoreAllMocks();

      mocks.mockFspReadFile({ config: {} });
      config = await cfg.getConfigFromUserPackage();
      expect(config).toMatchObject({});
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

   it("should resolve missing optional config to expected default config", async () => {
      mocks.mockFspStats(false);
      mocks.mockFspReadFile({ config: {} });
      const config = await cfg.getResolvedConfig();

      expect(config?.ipcSchema?.stats?.isDirectory()).toStrictEqual(false);
      expect(config?.ipcSchema?.stats?.isFile()).toStrictEqual(true);
      expect(config).toMatchObject({
         projectUsesNodeNext: false,
         ipcDataDir: "src/autoipc",
         codeIndent: 3,
         mainBindingsFilePath: "/home/user/project/src/autoipc/main.ts",
         preloadBindingsFilePath: "/home/user/project/src/autoipc/preload.ts",
         rendererTypesFilePath: "/home/user/project/src/autoipc/window.d.ts",
         ipcSchema: {
            path: "/home/user/project/src/autoipc/schema.ts",
         },
      });
   });

   it("should resolve optional config to expected config", async () => {
      mocks.mockFspStats(true);
      mocks.mockFspReadFile({
         config: {
            autoipc: {
               projectUsesNodeNext: true,
               ipcDataDir: "src/subpath/autoipc",
               codeIndent: 4,
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
         mainBindingsFilePath: "/home/user/project/src/subpath/autoipc/main.ts",
         preloadBindingsFilePath: "/home/user/project/src/subpath/autoipc/preload.ts",
         rendererTypesFilePath: "/home/user/project/src/subpath/autoipc/window.d.ts",
         ipcSchema: {
            path: "/home/user/project/src/subpath/autoipc/schema.ts",
         },
      });
   });
});
