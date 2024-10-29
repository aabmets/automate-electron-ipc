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

describe("extractReturnType", () => {
   it("should return 'void' as the returnType when match[4] is undefined", () => {
      const match = [undefined, undefined, undefined, undefined] as unknown as RegExpExecArray;
      const result = parser.extractReturnType(match);

      expect(result.returnType).toBe("void");
      expect(result.customTypes.size).toBe(0);
   });

   it("should return the trimmed returnType and an empty customTypes set if returnType is built-in", () => {
      const match = [undefined, undefined, undefined, ":", "string"] as unknown as RegExpExecArray;
      const result = parser.extractReturnType(match);

      expect(result.returnType).toBe("string");
      expect(result.customTypes.size).toBe(0);
   });

   it("should return the trimmed returnType and add to customTypes if returnType is custom", () => {
      const match = [
         undefined,
         undefined,
         undefined,
         ":",
         "CustomType",
      ] as unknown as RegExpExecArray;
      const result = parser.extractReturnType(match);

      expect(result.returnType).toBe("CustomType");
      expect(result.customTypes.has("CustomType")).toBe(true);
      expect(result.customTypes.size).toBe(1);
   });

   it("should handle return types with extra whitespace", () => {
      const match = [
         undefined,
         undefined,
         undefined,
         ":",
         "   CustomType   ",
      ] as unknown as RegExpExecArray;
      const result = parser.extractReturnType(match);

      expect(result.returnType).toBe("CustomType");
      expect(result.customTypes.has("CustomType")).toBe(true);
      expect(result.customTypes.size).toBe(1);
   });

   it("should ignore empty returnType and add no custom types if returnType is an empty string", () => {
      const match = [undefined, undefined, undefined, ":", ""] as unknown as RegExpExecArray;
      const result = parser.extractReturnType(match);

      expect(result.returnType).toBe("void");
      expect(result.customTypes.size).toBe(0);
   });
});
