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
import viUtils from "../vitest_utils";

describe("getFuncSpecs", () => {
   it("should match basic function specification", () => {
      const code = viUtils.dedent(`
         export function myFunction() {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "void",
         params: [],
      });
   });

   it("should capture builtin return type", () => {
      const code = viUtils.dedent(`
         export function myFunction(): unknown {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "unknown",
         params: [],
      });
   });

   it("should capture custom return type", () => {
      const code = viUtils.dedent(`
         export function myFunction(): CustomType {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: ["CustomType"],
         returnType: "CustomType",
         params: [],
      });
   });

   it("should capture string param type", () => {
      const code = viUtils.dedent(`
         export function myFunction(abc: string) {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "void",
         params: [
            {
               name: "abc",
               type: "string",
               defaultValue: null,
            },
         ],
      });
   });

   it("should capture custom param type", () => {
      const code = viUtils.dedent(`
         export function myFunction(abc: CustomType) {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: ["CustomType"],
         returnType: "void",
         params: [
            {
               name: "abc",
               type: "CustomType",
               defaultValue: null,
            },
         ],
      });
   });

   it("should capture param default value", () => {
      const code = viUtils.dedent(`
         export function myFunction(abc = 123) {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "void",
         params: [
            {
               name: "abc",
               type: null,
               defaultValue: "123",
            },
         ],
      });
   });

   it("should capture multiple params with types and default values", () => {
      const code = viUtils.dedent(`
         export function myFunction(
            abc: string = "xyz", 
            def: number = 123, 
            ghi: boolean = true
         ) {}
      `);
      const specs = parser.getFuncSpecs(code);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "void",
         params: [
            {
               name: "abc",
               type: "string",
               defaultValue: '"xyz"',
            },
            {
               name: "def",
               type: "number",
               defaultValue: "123",
            },
            {
               name: "ghi",
               type: "boolean",
               defaultValue: "true",
            },
         ],
      });
   });
});
