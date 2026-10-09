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

import { parseImportDeclarations } from "@testutils/parser/import-specs-utils.js";
import { describe, expect, it } from "vitest";

describe("parseImportDeclarations", () => {
   describe("Named Imports", () => {
      it("should record value imports, which may be used as types", () => {
         const code = `import { readFile, writeFile } from 'fs';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "fs",
               customTypes: ["readFile", "writeFile"],
               namespace: null,
            },
         ]);
      });

      it("should correctly parse named imports with type-only", () => {
         const code = `import type { SomeType, AnotherType } from 'types-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "types-module",
               customTypes: ["SomeType", "AnotherType"],
               namespace: null,
            },
         ]);
      });

      it("should correctly parse mixed type and non-type named imports", () => {
         const code = `import { type SomeType, someFunction } from 'module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "module",
               customTypes: ["SomeType", "someFunction"],
               namespace: null,
            },
         ]);
      });

      it("should exclude built-in types from customTypes", () => {
         const code = `import type { string, number, CustomType } from 'module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "module",
               customTypes: ["CustomType"],
               namespace: null,
            },
         ]);
      });

      // Regression for T60: an import takes precedence over the global of the same name.
      it("should record imports that are named like globals", () => {
         const result = parseImportDeclarations(
            `import type { Error, Map as M, Date as D } from 'module';`,
         );
         expect(result).toEqual([
            {
               fromPath: "module",
               customTypes: ["Error", "Map as M", "Date as D"],
               namespace: null,
            },
         ]);
      });

      it("should record a default import that is named like a global", () => {
         const result = parseImportDeclarations(`import Error from './error';`);
         expect(result[0].customTypes).toEqual(["default as Error"]);
      });

      it("should handle named imports with aliasing", () => {
         const code = `import { readFile as rf, writeFile as wf } from 'fs';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "fs",
               customTypes: ["readFile as rf", "writeFile as wf"],
               namespace: null,
            },
         ]);
      });

      it("should handle type-only named imports with aliasing", () => {
         const code = `import type { SomeType as ST, AnotherType as AT } from 'types-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "types-module",
               customTypes: ["SomeType as ST", "AnotherType as AT"],
               namespace: null,
            },
         ]);
      });

      it("should ignore empty named imports", () => {
         const code = `import { } from 'empty-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
      });

      it("should ignore built-in types in type-only named imports", () => {
         const code = `import type { string, boolean, CustomType } from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "some-module",
               customTypes: ["CustomType"],
               namespace: null,
            },
         ]);
      });

      it("should handle multiple named imports", () => {
         const result = parseImportDeclarations(`
            import { asdfg0 } from 'path0';
            import { asdfg1 } from 'path1';
            import { asdfg2 } from 'path2';
         `);
         expect(result).toEqual([
            {
               fromPath: "path0",
               customTypes: ["asdfg0"],
               namespace: null,
            },
            {
               fromPath: "path1",
               customTypes: ["asdfg1"],
               namespace: null,
            },
            {
               fromPath: "path2",
               customTypes: ["asdfg2"],
               namespace: null,
            },
         ]);
      });
   });
});
