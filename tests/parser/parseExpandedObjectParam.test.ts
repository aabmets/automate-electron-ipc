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

describe("parseExpandedObjectParam", () => {
   it("should remove '...' and trim spaces to return the correct type", () => {
      const customTypes = new Set<string>();
      const result = parser.parseExpandedObjectParam("... CustomType", customTypes);

      expect(result).toEqual({
         name: "",
         type: "CustomType",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should add a custom type to customTypes if type is not built-in", () => {
      const customTypes = new Set<string>();
      const result = parser.parseExpandedObjectParam("... AnotherCustomType", customTypes);

      expect(result).toEqual({
         name: "",
         type: "AnotherCustomType",
      });
      expect(customTypes.has("AnotherCustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });

   it("should not add built-in types to customTypes", () => {
      const customTypes = new Set<string>();
      const result = parser.parseExpandedObjectParam("... string", customTypes);

      expect(result).toEqual({
         name: "",
         type: "string",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should return 'unknown' type if input is only '...'", () => {
      const customTypes = new Set<string>();
      const result = parser.parseExpandedObjectParam("...", customTypes);

      expect(result).toEqual({
         name: "",
         type: "unknown",
      });
      expect(customTypes.size).toBe(0);
   });

   it("should handle types with extra whitespace correctly", () => {
      const customTypes = new Set<string>();
      const result = parser.parseExpandedObjectParam("...   CustomType   ", customTypes);

      expect(result).toEqual({
         name: "",
         type: "CustomType",
      });
      expect(customTypes.has("CustomType")).toBe(true);
      expect(customTypes.size).toBe(1);
   });
});
