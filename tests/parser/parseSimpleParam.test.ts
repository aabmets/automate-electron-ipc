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
import parser from "../../src/parser";

describe("parseSimpleParam", () => {
   it("should parse a parameter with a specified type", () => {
      const customTypes = new Set<string>();
      const result = parser.parseSimpleParam("paramName: CustomType", customTypes);

      expect(result).toEqual({
         name: "paramName",
         type: "CustomType",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should add a custom type to customTypes if type is not built-in", () => {
      const customTypes = new Set<string>();
      const result = parser.parseSimpleParam("anotherParam: AnotherCustomType", customTypes);

      expect(result).toEqual({
         name: "anotherParam",
         type: "AnotherCustomType",
      });
      expect(customTypes.has("AnotherCustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should not add built-in types to customTypes", () => {
      const customTypes = new Set<string>();
      const result = parser.parseSimpleParam("builtinParam: string", customTypes);

      expect(result).toEqual({
         name: "builtinParam",
         type: "string",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should handle parameters without a specified type by setting type to 'unknown'", () => {
      const customTypes = new Set<string>();
      const result = parser.parseSimpleParam("paramWithoutType", customTypes);

      expect(result).toEqual({
         name: "paramWithoutType",
         type: "unknown",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should handle parameters with extra whitespace correctly", () => {
      const customTypes = new Set<string>();
      const result = parser.parseSimpleParam("   paramWithSpaces   :   CustomType   ", customTypes);

      expect(result).toEqual({
         name: "paramWithSpaces",
         type: "CustomType",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });
});
