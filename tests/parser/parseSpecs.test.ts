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

import parser from "@src/parser";
import { describe, expect, it } from "vitest";

describe("parseContents", () => {
   it("should parse exported interfaces and types", () => {
      const { typeSpecArray } = parser.parseSpecs(`
         export interface MyInterface {
            property: string;
         }
         export type MyType = number | boolean;
      `);
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
      const { typeSpecArray } = parser.parseSpecs(`
         interface MyInterface {
            property: string;
         }
         type MyType = number | boolean;
      `);
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
      const { funcSpecArray } = parser.parseSpecs(`
         export function myFunction1(arg1: CustomType1): string {
            return;
         }
         export async function myFunction2(arg2: boolean): Promise<CustomType2> {
            return;
         }
      `);
      expect(funcSpecArray).toHaveLength(2);
      expect(funcSpecArray[0]).toMatchObject({
         name: "myFunction1",
         async: false,
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
         async: true,
         customTypes: ["CustomType2"],
         returnType: "Promise<CustomType2>",
         params: [
            {
               defaultValue: null,
               name: "arg2",
               type: "boolean",
            },
         ],
      });
   });

   it("should parse ES module import statements", () => {
      const { importSpecArray } = parser.parseSpecs(`
         import defaultExport1 from "module-name1";
         import { namedExport2 } from 'module-name2';
         import type { CustomType3 } from 'module-name3';
         import { namedExport4, type CustomType4 } from 'module-name4';
      `);
      expect(importSpecArray).toHaveLength(4);
      expect(importSpecArray[0]).toMatchObject({
         kind: "import",
         fromPath: "module-name1",
         definition: 'import defaultExport1 from "module-name1";\n',
         customTypes: [],
      });
      expect(importSpecArray[1]).toMatchObject({
         kind: "import",
         fromPath: "module-name2",
         definition: "import { namedExport2 } from 'module-name2';\n",
         customTypes: [],
      });
      expect(importSpecArray[2]).toMatchObject({
         kind: "import",
         fromPath: "module-name3",
         definition: "import type { CustomType3 } from 'module-name3';\n",
         customTypes: ["CustomType3"],
      });
      expect(importSpecArray[3]).toMatchObject({
         kind: "import",
         fromPath: "module-name4",
         definition: "import { namedExport4, type CustomType4 } from 'module-name4';\n",
         customTypes: ["CustomType4"],
      });
   });
});
