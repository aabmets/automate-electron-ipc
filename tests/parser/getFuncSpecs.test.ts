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

import parser from "@parser";
import { describe, expect, it } from "vitest";

describe("getFuncSpecs", () => {
   it("should match basic function specification", () => {
      const specs = parser.getFuncSpecs(`
         export function myFunction() {}
      `);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "void",
         params: [],
      });
   });

   it("should capture builtin return type", () => {
      const specs = parser.getFuncSpecs(`
         export function myFunction(): unknown {}
      `);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: [],
         returnType: "unknown",
         params: [],
      });
   });

   it("should capture custom return type", () => {
      const specs = parser.getFuncSpecs(`
         export function myFunction(): CustomType {}
      `);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({
         name: "myFunction",
         customTypes: ["CustomType"],
         returnType: "CustomType",
         params: [],
      });
   });

   it("should capture string param type", () => {
      const specs = parser.getFuncSpecs(`
         export function myFunction(abc: string) {}
      `);
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
      const specs = parser.getFuncSpecs(`
         export function myFunction(abc: CustomType) {}
      `);
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
      const specs = parser.getFuncSpecs(`
         export function myFunction(abc = 123) {}
      `);
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
      const specs = parser.getFuncSpecs(`
         export function myFunction(
            abc: string = "xyz", 
            def: number = 123, 
            ghi: boolean = true
         ) {}
      `);
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
