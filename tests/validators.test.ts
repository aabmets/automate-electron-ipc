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

   it("should validate and resolve configuration with valid inputs", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         ipcSpecPath: "src/custom-ipc-spec.ts",
         rendererDir: "src/custom-renderer",
         codeIndent: 4,
      };

      const result = validateResolveConfig(config);

      expect(result).toEqual({
         ipcSpecPath: "/resolved/src/custom-ipc-spec.ts",
         rendererDir: "/resolved/src/custom-renderer",
         codeIndent: 4,
      });
   });

   it("should throw an error if ipcSpecPath is absolute", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         ipcSpecPath: "/absolute/path/ipc-spec.ts",
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "ipcSpecPath must be relative to the project root",
      );
   });

   it("should throw an error if rendererDir is absolute", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         rendererDir: "/absolute/path/renderer",
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "rendererDir must be relative to the project root",
      );
   });

   it("should throw an error if ipcSpecPath and rendererDir are identical", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         ipcSpecPath: "src/shared-path",
         rendererDir: "src/shared-path",
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "ipcSpecPath and rendererDir cannot be identical",
      );
   });

   it("should throw an error if ipcSpecPath is inside rendererDir", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         ipcSpecPath: "src/renderer/ipc-spec.ts",
         rendererDir: "src/renderer",
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "ipcSpecPath cannot be relative to rendererDir",
      );
   });

   it("should throw an error if rendererDir is inside ipcSpecPath", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         ipcSpecPath: "src",
         rendererDir: "src/renderer",
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "rendererDir cannot be relative to ipcSpecPath",
      );
   });

   it("should throw an error if codeIndent is less than 2", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         codeIndent: 1,
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "value cannot be less than 2 or greater than 4",
      );
   });

   it("should throw an error if codeIndent is greater than 4", () => {
      const config: Partial<t.IPCOptionalConfig> = {
         codeIndent: 5,
      };

      expect(() => validateResolveConfig(config)).toThrow(
         "value cannot be less than 2 or greater than 4",
      );
   });

   it("should use default values when no configuration is provided", () => {
      const result = validateResolveConfig();

      expect(result).toEqual({
         ipcSpecPath: "/resolved/src/ipc-spec.ts",
         rendererDir: "/resolved/src/renderer",
         codeIndent: 3,
      });
   });
});
