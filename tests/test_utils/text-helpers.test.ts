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

import { concatRegex, dedent } from "@testutils/text-utils.js";
import { describe, expect, it } from "vitest";

describe("concatRegex", () => {
   it("should concatenate multiple regex patterns into a single pattern", () => {
      const pattern = concatRegex([
         /^/, // Start of string
         /[a-zA-Z]+/, // One or more letters
         /\s+/, // Whitespace
         /\d+/, // One or more digits
         /\s+/, // Whitespace
         /[a-zA-Z]+/, // One or more letters
         /$/, // End of string
      ]);
      expect(pattern.source).toEqual("^[a-zA-Z]+\\s+\\d+\\s+[a-zA-Z]+$");
   });
});

describe("dedent", () => {
   it("should dedent code written in template strings", () => {
      const result = dedent(`
         const obj = {
            nested: {
               data: "asdfg",
            },
            data: 123,
         }
      `);
      expect(result.trim()).toStrictEqual(
         [
            "const obj = {",
            "   nested: {",
            '      data: "asdfg",',
            "   },",
            "   data: 123,",
            "}",
         ].join("\n"),
      );
   });
});
