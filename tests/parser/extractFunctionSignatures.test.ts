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
import type { IPCFunction } from "../../src/parser";
import parser from "../../src/parser";

describe("extractFunctionSignatures", () => {
   it("should extract a single function signature with built-in return type and parameters", () => {
      const fileContent = `
         export function testFunction(param1: string, param2: number): void {
            // function body
         }
      `;
      const expected: IPCFunction[] = [
         {
            name: "testFunction",
            params: [
               { name: "param1", type: "string" },
               { name: "param2", type: "number" },
            ],
            returnType: "void",
            customTypes: [],
         },
      ];

      const result = parser.extractFunctionSignatures(fileContent);

      expect(result).toEqual(expected);
   });

   it("should extract multiple function signatures with mixed return types", () => {
      const fileContent = `
         export function firstFunction(): string {
            // function body
         }
         export function secondFunction(param: CustomType): CustomType {
            // function body
         }
      `;
      const expected: IPCFunction[] = [
         {
            name: "firstFunction",
            params: [],
            returnType: "string",
            customTypes: [],
         },
         {
            name: "secondFunction",
            params: [{ name: "param", type: "CustomType" }],
            returnType: "CustomType",
            customTypes: ["CustomType"],
         },
      ];

      const result = parser.extractFunctionSignatures(fileContent);

      expect(result).toEqual(expected);
   });

   it("should handle functions without specified return types", () => {
      const fileContent = `
         export function noReturnType(param1: string) {
            // function body
         }
      `;
      const expected: IPCFunction[] = [
         {
            name: "noReturnType",
            params: [{ name: "param1", type: "string" }],
            returnType: "void",
            customTypes: [],
         },
      ];

      const result = parser.extractFunctionSignatures(fileContent);

      expect(result).toEqual(expected);
   });

   it("should handle functions with complex parameter types", () => {
      const fileContent = `
         export function complexParams(param1: { name: string }, param2: AnotherType[]): void {
            // function body
         }
      `;
      const expected: IPCFunction[] = [
         {
            name: "complexParams",
            params: [
               { name: "param1", type: "{ name: string }" },
               { name: "param2", type: "AnotherType[]" },
            ],
            returnType: "void",
            customTypes: ["AnotherType"],
         },
      ];

      const result = parser.extractFunctionSignatures(fileContent);

      expect(result).toEqual(expected);
   });

   it("should handle functions with spread and optional parameters", () => {
      const fileContent = `
         export function spreadAndOptional(param1: string, ...rest: CustomType[]): void {
            // function body
         }
      `;
      const expected: IPCFunction[] = [
         {
            name: "spreadAndOptional",
            params: [
               { name: "param1", type: "string" },
               { name: "", type: "CustomType[]" },
            ],
            returnType: "void",
            customTypes: ["CustomType"],
         },
      ];

      const result = parser.extractFunctionSignatures(fileContent);

      expect(result).toEqual(expected);
   });
});
