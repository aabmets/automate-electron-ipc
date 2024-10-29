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

import { type Mock, describe, expect, it, vi } from "vitest";
import parser from "../../src/parser";
import utils from "../../src/utils";

vi.mock("../../src/utils", () => ({
   default: {
      concatRegex: vi.fn(),
   },
}));

describe("getFunctionSignatureRegex", () => {
   it("should call utils.concatRegex with the correct regex patterns and flags", () => {
      parser.getFunctionSignatureRegex();
      expect(utils.concatRegex).toHaveBeenCalledWith(
         [
            /export\s+function\s+/,
            /([a-zA-Z0-9_]+)\s*\(/,
            /([^)]*)\)\s*/,
            /(:\s*([a-zA-Z0-9_\[\]\s<>,]+))?/,
         ],
         "g",
      );
   });

   it("should return a RegExp", () => {
      const mockRegex = /mocked-regex/g;
      (utils.concatRegex as Mock).mockReturnValue(mockRegex);

      const result = parser.getFunctionSignatureRegex();
      expect(result).toBeInstanceOf(RegExp);
      expect(result).toBe(mockRegex);
   });
});
