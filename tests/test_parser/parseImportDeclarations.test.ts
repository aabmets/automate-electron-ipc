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

import { forEachChild, parseModule } from "@src/ast.js";
import parser from "@src/parser.js";
import type { ImportDeclaration } from "@swc/core";
import * as t from "@types";
import { describe, expect, it } from "vitest";

function parseImportDeclarations(code: string): t.ImportSpec[] {
   const { module, src } = parseModule(code);
   const specs: t.ImportSpec[] = [];
   forEachChild(module, (node) => {
      if (node.type === "ImportDeclaration") {
         parser.parseImportDeclarations(node as ImportDeclaration, src, specs);
      }
   });
   return specs;
}

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
