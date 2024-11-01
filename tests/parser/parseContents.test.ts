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

describe("parseContents", () => {
   it("should parse exported interfaces and types", () => {
      const code = viUtils.dedent(`
         export interface MyInterface {
            property: string;
         }
         export type MyType = number | boolean;
      `);
      const { typeSpecArray } = parser.parseContents(code);
      expect(typeSpecArray).toHaveLength(2);
      expect(typeSpecArray[0]).toMatchObject({
         name: "MyInterface",
         kind: "interface",
         isExported: true,
         definition: "export interface MyInterface {\n   property: string;\n}\n",
      });
      expect(typeSpecArray[1]).toMatchObject({
         name: "MyType",
         kind: "type",
         isExported: true,
         definition: "export type MyType = number | boolean;\n",
      });
   });

   it("should parse non-exported interfaces and types", () => {
      const code = viUtils.dedent(`
         interface MyInterface {
            property: string;
         }
         type MyType = number | boolean;
      `);
      const { typeSpecArray } = parser.parseContents(code);
      expect(typeSpecArray).toHaveLength(2);
      expect(typeSpecArray[0]).toMatchObject({
         name: "MyInterface",
         kind: "interface",
         isExported: false,
         definition: "interface MyInterface {\n   property: string;\n}\n",
      });
      expect(typeSpecArray[1]).toMatchObject({
         name: "MyType",
         kind: "type",
         isExported: false,
         definition: "type MyType = number | boolean;\n",
      });
   });

   it("should parse multiple functions", () => {
      const code = viUtils.dedent(`
         export function myFunction1(arg1: CustomType1): string {
            return;
         }
         export function myFunction2(arg2: boolean): CustomType2 {
            return;
         }
      `);
      const { funcSpecArray } = parser.parseContents(code);
      expect(funcSpecArray).toHaveLength(2);
      expect(funcSpecArray[0]).toMatchObject({
         name: "myFunction1",
         customTypes: ["CustomType1"],
         returnType: "string",
         params: [
            {
               defaultValue: null,
               name: "arg1",
               type: "CustomType1",
            },
         ],
      });
      expect(funcSpecArray[1]).toMatchObject({
         name: "myFunction2",
         customTypes: ["CustomType2"],
         returnType: "CustomType2",
         params: [
            {
               defaultValue: null,
               name: "arg2",
               type: "boolean",
            },
         ],
      });
   });
});
