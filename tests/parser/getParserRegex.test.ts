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
import utils from "@src/utils";
import { describe, expect, it } from "vitest";

describe("getParserRegex", () => {
   it("should match exported function syntax", () => {
      const regex = parser.getParserRegex();
      const functionExportString = utils.dedent(`
         export function myFunction() {
            return;
         }
      `);
      expect(regex.test(functionExportString)).toBe(true);
   });

   it("should match exported async function syntax", () => {
      const regex = parser.getParserRegex();
      const functionExportString = utils.dedent(`
         export async function myFunction() {
            return;
         }
      `);
      expect(regex.test(functionExportString)).toBe(true);
   });

   it("should not match non-exported function syntax", () => {
      const regex = parser.getParserRegex();
      const functionExportString = utils.dedent(`
         function myFunction() {
            return;
         }
         async function myFunction() {
            return;
         }
      `);
      expect(regex.test(functionExportString)).toBe(false);
   });

   it("should match exported interface syntax", () => {
      const regex = parser.getParserRegex();
      const interfaceExportString = utils.dedent(`
         export interface MyInterface {
            property: string;
         }
      `);
      expect(regex.test(interfaceExportString)).toBe(true);
   });

   it("should match non-exported interface syntax", () => {
      const regex = parser.getParserRegex();
      const interfaceString = utils.dedent(`
         interface MyInterface {
            property: string;
         }
      `);
      expect(regex.test(interfaceString)).toBe(true);
   });

   it("should match export type syntax", () => {
      const regex = parser.getParserRegex();
      const typeExportString = utils.dedent(`
         export type MyType = {
            property: string;
         };
      `);
      expect(regex.test(typeExportString)).toBe(true);
   });

   it("should match non-exported type syntax", () => {
      const regex = parser.getParserRegex();
      const typeString = utils.dedent(`
         type MyType = {
            property: string;
         };
      `);
      expect(regex.test(typeString)).toBe(true);
   });

   it("should match default import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         import defaultExport from "module-name";
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match named import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         import { namedExport } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match multiline named import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         import { 
            namedExport1, 
            namedExport2 
         } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match named types import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         import type { CustomType } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match objects and named types import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         import { namedExport, type CustomType } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should not match require import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = utils.dedent(`
         const module = require('module-name');
      `);
      expect(regex.test(importString)).toBe(false);
   });

   it("should not match non-required variable declarations", () => {
      const regex = parser.getParserRegex();
      [
         "const myFunc = () => null",
         "const myVar = 42;",
         "let myVar = [1, 2, 3];",
         "var myVar = { x, y, z };",
      ].forEach((item) => {
         expect(regex.test(item)).toBe(false);
      });
   });

   it("should not match class declarations", () => {
      const regex = parser.getParserRegex();
      const classDeclaration = utils.dedent(`
         class CustomClass {
            constructor(value) {
               this.value = value;
            }
            print() {
               console.log(this.value);
            }
         }
      `);
      expect(regex.test(classDeclaration)).toBe(false);
   });
});
