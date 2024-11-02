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

describe("getParserRegex", () => {
   it("should match exported function syntax", () => {
      const regex = parser.getParserRegex();
      const functionExportString = viUtils.dedent(`
         export function myFunction() {
            return;
         }
      `);
      expect(regex.test(functionExportString)).toBe(true);
   });

   it("should not match non-exported function syntax", () => {
      const regex = parser.getParserRegex();
      const functionExportString = viUtils.dedent(`
         function myFunction() {
            return;
         }
      `);
      expect(regex.test(functionExportString)).toBe(false);
   });

   it("should match exported interface syntax", () => {
      const regex = parser.getParserRegex();
      const interfaceExportString = viUtils.dedent(`
         export interface MyInterface {
            property: string;
         }
      `);
      expect(regex.test(interfaceExportString)).toBe(true);
   });

   it("should match non-exported interface syntax", () => {
      const regex = parser.getParserRegex();
      const interfaceString = viUtils.dedent(`
         interface MyInterface {
            property: string;
         }
      `);
      expect(regex.test(interfaceString)).toBe(true);
   });

   it("should match export type syntax", () => {
      const regex = parser.getParserRegex();
      const typeExportString = viUtils.dedent(`
         export type MyType = {
            property: string;
         };
      `);
      expect(regex.test(typeExportString)).toBe(true);
   });

   it("should match non-exported type syntax", () => {
      const regex = parser.getParserRegex();
      const typeString = viUtils.dedent(`
         type MyType = {
            property: string;
         };
      `);
      expect(regex.test(typeString)).toBe(true);
   });

   it("should match default import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         import defaultExport from "module-name";
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match named import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         import { namedExport } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match multiline named import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         import { 
            namedExport1, 
            namedExport2 
         } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match named types import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         import type { CustomType } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match objects and named types import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         import { namedExport, type CustomType } from 'module-name';
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match require module import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         const module = require('module-name');
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match named require import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         const { namedExport } = require('module-name');
      `);
      expect(regex.test(importString)).toBe(true);
   });

   it("should match multiline named require import syntax", () => {
      const regex = parser.getParserRegex();
      const importString = viUtils.dedent(`
         const { 
            namedExport1,
            namedExport2
         } = require('module-name');
      `);
      expect(regex.test(importString)).toBe(true);
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
      const classDeclaration = viUtils.dedent(`
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
