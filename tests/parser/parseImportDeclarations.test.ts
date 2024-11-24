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

import parser from "@src/parser";
import * as t from "@types";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parseImportDeclarations(code: string): t.ImportSpec[] {
   const src = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.Latest, true);
   const specs: t.ImportSpec[] = [];
   ts.forEachChild(src, (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
         parser.parseImportDeclarations(node as ts.ImportDeclaration, src, specs);
      }
   });
   return specs;
}

describe("parseImportDeclarations", () => {
   describe("Namespace Imports", () => {
      it("should correctly parse a namespace import", () => {
         const code = `import * as fs from 'fs';`;
         const result = parseImportDeclarations(code);
         expect(result).toStrictEqual([
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

   describe("Named Imports", () => {
      it("should correctly parse named imports without type-only", () => {
         const code = `import { readFile, writeFile } from 'fs';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "fs",
               customTypes: [],
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
               customTypes: ["SomeType"],
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

      it("should handle named imports with aliasing", () => {
         const code = `import { readFile as rf, writeFile as wf } from 'fs';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "fs",
               customTypes: [],
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

      it("should handle empty named imports", () => {
         const code = `import { } from 'empty-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "empty-module",
               customTypes: [],
               namespace: null,
            },
         ]);
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
               customTypes: [],
               namespace: null,
            },
            {
               fromPath: "path1",
               customTypes: [],
               namespace: null,
            },
            {
               fromPath: "path2",
               customTypes: [],
               namespace: null,
            },
         ]);
      });
   });

   describe("Default Imports", () => {
      it("should ignore default imports", () => {
         const code = `import asdfg from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
      });

      it("should ignore default and named imports together", () => {
         const code = `import asdfg, { qwerty } from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "some-module",
               customTypes: [],
               namespace: null,
            },
         ]);
      });

      it("should ignore default and namespace imports together", () => {
         const code = `import asdfg, * as qwerty from 'some-module';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([
            {
               fromPath: "some-module",
               customTypes: [],
               namespace: "qwerty",
            },
         ]);
      });
   });

   describe("Side-effect Imports", () => {
      it("should ignore side-effect imports without namedBindings", () => {
         const code = `import 'module-with-side-effects';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
      });

      it("should ignore type-only side-effect imports", () => {
         const code = `import type 'types-side-effect';`;
         const result = parseImportDeclarations(code);
         expect(result).toEqual([]);
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
