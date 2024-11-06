/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import utils from "@src/utils";
import { validateOptions } from "@src/validators";
import type { IPCAutomationOption } from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("validateOptions", () => {
   const mockSearchUpwards = (path: string) => path;

   beforeEach(() => {
      vi.spyOn(utils, "searchUpwards").mockImplementation(mockSearchUpwards);
   });

   afterEach(() => {
      vi.restoreAllMocks();
   });

   it("should pass with valid options", () => {
      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/browser/preload.js",
            rendererTypesFile: "/renderer/types.js",
         },
      ];

      expect(() => validateOptions(options)).not.toThrow();
   });

   it("should throw errors when options array is not provided or empty", () => {
      const options = null as unknown as IPCAutomationOption[];
      expect(() => validateOptions(options)).toThrow("Please read the documentation");
      expect(() => validateOptions([])).toThrow("Please read the documentation");
   });

   it("should throw an error if mainHandlersDir is not found", () => {
      vi.spyOn(utils, "searchUpwards").mockReturnValueOnce("");

      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/invalid/path",
            browserPreloadFile: "/browser/preload.js",
            rendererTypesFile: "/renderer/types.js",
         },
      ];

      expect(() => validateOptions(options)).toThrow("mainHandlersDir path not found");
   });

   it("should throw an error if browserPreloadFile and rendererTypesFile are the same", () => {
      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/same/path/file.js",
            rendererTypesFile: "/same/path/file.js",
         },
      ];

      expect(() => validateOptions(options)).toThrow(
         "browserPreloadFile and rendererTypesFile cannot be the same file",
      );
   });

   it("should throw an error if browserPreloadFile is inside mainHandlersDir", () => {
      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/main/handlers/preload.js",
            rendererTypesFile: "/renderer/types.js",
         },
      ];

      expect(() => validateOptions(options)).toThrow(
         "browserPreloadFile (1) cannot be inside mainHandlersDir (2):",
      );
   });

   it("should throw an error if rendererTypesFile is inside mainHandlersDir", () => {
      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/browser/preload.js",
            rendererTypesFile: "/main/handlers/types.js",
         },
      ];

      expect(() => validateOptions(options)).toThrow(
         "rendererTypesFile (1) cannot be inside mainHandlersDir (2):",
      );
   });

   it("should throw an error if any path is used by another IPCAutomationOption", () => {
      const options: IPCAutomationOption[] = [
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/browser/preload.js",
            rendererTypesFile: "/renderer/types.js",
         },
         {
            mainHandlersDir: "/main/handlers",
            browserPreloadFile: "/another/browser/preload.js",
            rendererTypesFile: "/another/renderer/types.js",
         },
      ];

      expect(() => validateOptions(options)).toThrow(
         "Path is already used by another IPCAutomationOption:",
      );
   });
});
