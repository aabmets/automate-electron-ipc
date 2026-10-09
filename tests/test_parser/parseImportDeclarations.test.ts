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
   describe("Namespace Imports", () => {
      it("should correctly parse a namespace import", () => {
         const code = `import * as fs from 'fs';`;
         expect(parseImportDeclarations(code)).toStrictEqual([
            {
               fromPath: "fs",
               customTypes: [],
               namespace: "fs",
            },
         ]);
      });

      it("should handle multiple namespace imports", () => {
         const result = parseImportDeclarations(`
            import * as fs from 'fs';
            import * as path from 'path';
         `);
         expect(result).toEqual([
            {
               fromPath: "fs",
               customTypes: [],
               namespace: "fs",
            },
            {
               fromPath: "path",
               customTypes: [],
               namespace: "path",
            },
         ]);
      });

      it("should handle namespace imports that are type-only", () => {
         const code = `import type * as types from 'types-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "types-module",
               customTypes: [],
               namespace: "types",
            },
         ]);
      });
   });

   describe("Default Imports", () => {
      it("should record a default import as the default export under its local name", () => {
         const code = `import Settings from './settings';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "./settings",
               customTypes: ["default as Settings"],
               namespace: null,
            },
         ]);
      });

      it("should record a type-only default import", () => {
         const code = `import type Settings from './settings';`;
         const result = parseImportDeclarations(code);
         expect(result[0]?.customTypes).toEqual(["default as Settings"]);
      });

      it("should record default and named imports together", () => {
         const code = `import asdfg, { qwerty, zxcv as ZXCV } from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "some-module",
               customTypes: ["default as asdfg", "qwerty", "zxcv as ZXCV"],
               namespace: null,
            },
         ]);
      });

      it("should record default and namespace imports together", () => {
         const code = `import asdfg, * as qwerty from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "some-module",
               customTypes: ["default as asdfg"],
               namespace: "qwerty",
            },
         ]);
      });

      it("should exclude default imports named like built-in types", () => {
         const result = parseImportDeclarations(`import string from 'some-module';`);
         expect(result).toEqual([{ fromPath: "some-module", customTypes: [], namespace: null }]);
      });
   });

   describe("Side-effect Imports", () => {
      it("should ignore side-effect imports without namedBindings", () => {
         const code = `import 'module-with-side-effects';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
      });

      it("should reject type-only side-effect imports as invalid syntax", () => {
         const code = `import type 'types-side-effect';`;
         expect(() => parseImportDeclarations(code)).toThrow();
      });
   });

   describe("H. Edge Cases and Boundary Conditions", () => {
      it("should return an empty array for empty source code", () => {
         const result = parseImportDeclarations("");
         expect(result).toEqual([]);
      });

      it("should handle source code with only side-effect imports", () => {
         const code = "import 'module-one'; import 'module-two';";
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
      });

      it("should handle source code with comments and irrelevant code", () => {
         const result = parseImportDeclarations(`
            // This is a comment
            import { type SomeType1 } from 'path1'; // Importing readFile
            const x = 10;
            /* Multi-line
               comment */
            import type { SomeType2 } from 'path2';
         `);
         expect(result).toEqual([
            {
               fromPath: "path1",
               customTypes: ["SomeType1"],
               namespace: null,
            },
            {
               fromPath: "path2",
               customTypes: ["SomeType2"],
               namespace: null,
            },
         ]);
      });

      it("should handle imports with excessive whitespace", () => {
         const result = parseImportDeclarations(`
            import    *    as    asdfg    from    'path0'   ;
            import    {    type    SomeType1   }    from    './path1'   ;
            import    type    {    SomeType2   }    from    '../path2'   ;
         `);
         expect(result).toEqual([
            {
               fromPath: "path0",
               customTypes: [],
               namespace: "asdfg",
            },
            {
               fromPath: "./path1",
               customTypes: ["SomeType1"],
               namespace: null,
            },
            {
               fromPath: "../path2",
               customTypes: ["SomeType2"],
               namespace: null,
            },
         ]);
      });
   });
});
