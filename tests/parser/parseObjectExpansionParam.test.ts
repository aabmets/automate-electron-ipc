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

describe("parseObjectExpansionParam", () => {
   it("should return the correct type with an explicit inner type", () => {
      const customTypes = new Set<string>();
      const result = parser.parseObjectExpansionParam("{ arg1: string }", customTypes);

      expect(result).toEqual({
         name: "",
         type: "{ arg1: string }",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should add a custom inner type to customTypes if not a built-in type", () => {
      const customTypes = new Set<string>();
      const result = parser.parseObjectExpansionParam("{ arg1: CustomType }", customTypes);

      expect(result).toEqual({
         name: "",
         type: "{ arg1: CustomType }",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should handle object expansion without explicit type by assigning unknown", () => {
      const customTypes = new Set<string>();
      const result = parser.parseObjectExpansionParam("{ arg1 }", customTypes);

      expect(result).toEqual({
         name: "",
         type: "{ arg1: unknown }",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should handle inner param with spaces correctly", () => {
      const customTypes = new Set<string>();
      const result = parser.parseObjectExpansionParam("{   arg1   :   CustomType   }", customTypes);

      expect(result).toEqual({
         name: "",
         type: "{ arg1: CustomType }",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should not add built-in types to customTypes", () => {
      const customTypes = new Set<string>();
      const result = parser.parseObjectExpansionParam("{ arg1: number }", customTypes);

      expect(result).toEqual({
         name: "",
         type: "{ arg1: number }",
      });
      expect(customTypes.size).toBe(0);
   });
});
