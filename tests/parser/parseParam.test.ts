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

describe("parseParam", () => {
   it("should call parseObjectExpansionParam for parameters enclosed in braces", () => {
      const customTypes = new Set<string>();
      const param = "{ arg1: CustomType }";
      const expected: IPCParams = { name: "", type: "{ arg1: CustomType }" };

      const result = parser.parseParam(param, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
   });

   it("should call parseExpandedObjectParam for parameters starting with '...'", () => {
      const customTypes = new Set<string>();
      const param = "...expandedType";
      const expected: IPCParams = { name: "expandedType", type: "unknown" };

      const result = parser.parseParam(param, customTypes);

      expect(result).toEqual(expected);
   });

   it("should call parseSimpleParam for simple parameters", () => {
      const customTypes = new Set<string>();
      const param = "simpleParam: string";
      const expected: IPCParams = { name: "simpleParam", type: "string" };

      const result = parser.parseParam(param, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.size).toBe(0); // No custom types added for built-in type 'string'
   });

   it("should trim whitespace from the parameter before parsing", () => {
      const customTypes = new Set<string>();
      const param = "   simpleParam: CustomType   ";
      const expected: IPCParams = { name: "simpleParam", type: "CustomType" };

      const result = parser.parseParam(param, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.has("CustomType")).toBe(true);
   });

   it("should handle parameters without a specified type", () => {
      const customTypes = new Set<string>();
      const param = "paramWithoutType";
      const expected: IPCParams = { name: "paramWithoutType", type: "unknown" };

      const result = parser.parseParam(param, customTypes);

      expect(result).toEqual(expected);
      expect(customTypes.size).toBe(0); // No custom types added for 'unknown'
   });
});
