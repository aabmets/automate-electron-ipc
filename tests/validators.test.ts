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

import utils from "@src/utils";
import { validateResolveConfig } from "@src/validators";
import * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("validateResolveConfig", () => {
   beforeEach(() => {
      const spy = vi.spyOn(utils, "resolveUserProjectPath");
      spy.mockImplementation((path) => `/resolved/${path}`);
   });

   afterEach(() => {
      vi.restoreAllMocks();
   });

   it("should validate and resolve configuration with valid inputs", async () => {
      const config: t.IPCOptionalConfig = {
         projectUsesNodeNext: true,
         ipcDataDir: "src/auto-ipc",
         codeIndent: 4,
      };

      const result = await validateResolveConfig(config);
      expect(result).toStrictEqual({
         ipcDataDir: "src/auto-ipc",
         mainBindingsFilePath: "/resolved/src/auto-ipc/main.ts",
         preloadBindingsFilePath: "/resolved/src/auto-ipc/preload.ts",
         rendererTypesFilePath: "/resolved/src/auto-ipc/window.d.ts",
         projectUsesNodeNext: true,
         codeIndent: 4,
         ipcSchema: {
            path: "/resolved/src/auto-ipc/schema.ts",
            stats: null,
         },
      });
   });

   it("should use default values when no configuration is provided", async () => {
      const result = await validateResolveConfig();

      expect(result).toStrictEqual({
         ipcDataDir: "src/ipc",
         mainBindingsFilePath: "/resolved/src/ipc/main.ts",
         preloadBindingsFilePath: "/resolved/src/ipc/preload.ts",
         rendererTypesFilePath: "/resolved/src/ipc/window.d.ts",
         projectUsesNodeNext: false,
         codeIndent: 3,
         ipcSchema: {
            path: "/resolved/src/ipc/schema.ts",
            stats: null,
         },
      });
   });

   it("should throw an error if ipcDataDir path is absolute", async () => {
      const config: t.IPCOptionalConfig = {
         ipcDataDir: "/absolute/path/auto-ipc",
      };
      try {
         await validateResolveConfig(config);
      } catch {
         return;
      }
      throw new Error("Absolute ipcDataDir path must throw Struct error");
   });

   it("should throw an error if codeIndent is less than 2", async () => {
      const config: Partial<t.IPCOptionalConfig> = {
         codeIndent: 1,
      };
      try {
         await validateResolveConfig(config);
      } catch {
         return;
      }
      throw new Error("codeIndent cannot be less than 2");
   });

   it("should throw an error if codeIndent is greater than 4", async () => {
      const config: Partial<t.IPCOptionalConfig> = {
         codeIndent: 5,
      };
      try {
         await validateResolveConfig(config);
      } catch {
         return;
      }
      throw new Error("codeIndent cannot be greater than 4");
   });
});
