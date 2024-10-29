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

import { describe, expect, it } from "vitest";
import type { IPCParams } from "../../src/parser";
import parser from "../../src/parser";

describe("extractFunctionParams", () => {
   it("should parse multiple parameters and add custom types", () => {
      const customTypes = new Set<string>();
      const parameters = "param1: string, param2: CustomType, param3: number";
      const expected: IPCParams[] = [
         { name: "param1", type: "string" },
         { name: "param2", type: "CustomType" },
         { name: "param3", type: "number" },
      ];

      const result = parser.extractFunctionParams(parameters, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should handle a single parameter and add it as a custom type if applicable", () => {
      const customTypes = new Set<string>();
      const parameters = "param1: CustomType";
      const expected: IPCParams[] = [{ name: "param1", type: "CustomType" }];

      const result = parser.extractFunctionParams(parameters, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should ignore empty parameters", () => {
      const customTypes = new Set<string>();
      const parameters = "param1: string, , param3: number";
      const expected: IPCParams[] = [
         { name: "param1", type: "string" },
         { name: "param3", type: "number" },
      ];

      const result = parser.extractFunctionParams(parameters, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.size).toBe(0); // No custom types added
   });

   it("should handle parameters with unknown types", () => {
      const customTypes = new Set<string>();
      const parameters = "param1, param2: CustomType";
      const expected: IPCParams[] = [
         { name: "param1", type: "unknown" },
         { name: "param2", type: "CustomType" },
      ];

      const result = parser.extractFunctionParams(parameters, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should trim whitespace around parameters", () => {
      const customTypes = new Set<string>();
      const parameters = "   param1: string   , param2 :   CustomType   ";
      const expected: IPCParams[] = [
         { name: "param1", type: "string" },
         { name: "param2", type: "CustomType" },
      ];

      const result = parser.extractFunctionParams(parameters, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });
});
