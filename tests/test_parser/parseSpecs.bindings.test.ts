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

import { parseModule } from "@src/parser/ast.js";
import { collectModuleBindings } from "@src/parser/module-bindings.js";
import parser from "@src/parser/parser.js";
import { describe, expect, it } from "vitest";

describe("collectModuleBindings", () => {
   const bindings = (code: string) => [...collectModuleBindings(parseModule(code).module)];

   it("lists imports and declared types, however they are exported", () => {
      expect(
         bindings(`
            import A, { B, C as D } from "m";
            import * as E from "n";
            export interface F {}
            type G = string;
            export enum H { x }
            declare class I {}
            namespace K {}
         `),
      ).toStrictEqual(["A", "B", "D", "E", "F", "G", "H", "I", "K"]);
   });

   it("lists the names of import-equals declarations", () => {
      expect(
         bindings('import A = B.C;\nexport import D = require("d");\nimport type E = F.G;'),
      ).toStrictEqual(["A", "D", "E"]);
   });

   it("ignores values and declarations that name nothing", () => {
      expect(
         bindings(`
            const value = 1;
            function fn() {}
            declare module "x" {}
            declare global { interface Window {} }
         `),
      ).toStrictEqual([]);
   });
});

describe("parseSpecs, import-equals", () => {
   const specs = (body: string) =>
      parser.parseSpecs({ contents: body, relativePath: "", fullPath: "" });

   it("records an exported alias as an exported declaration of the schema file", () => {
      const { typeSpecArray, importSpecArray } = specs(
         'import * as Models from "./models";\nexport import User = Models.User;',
      );
      expect(typeSpecArray).toStrictEqual([
         { name: "User", kind: "alias", generics: null, isExported: true },
      ]);
      expect(importSpecArray).toHaveLength(1);
   });

   it("records an alias that is not exported with the qualified name of its target", () => {
      const { typeSpecArray } = specs("import Point = Models.Shapes.Point;");
      expect(typeSpecArray).toStrictEqual([
         {
            name: "Point",
            kind: "alias",
            generics: null,
            isExported: false,
            aliasOf: "Models.Shapes.Point",
         },
      ]);
   });

   it("exports an alias through an export specifier", () => {
      const { typeSpecArray } = specs("import Point = Models.Point;\nexport { Point };");
      expect(typeSpecArray[0]).toMatchObject({ name: "Point", isExported: true });
   });

   it("records the require form as a namespace import, or as an exported declaration", () => {
      const { typeSpecArray, importSpecArray } = specs(
         'import Models = require("./models");\nexport import Shared = require("./shared");',
      );
      expect(importSpecArray).toStrictEqual([
         { fromPath: "./models", customTypes: [], namespace: "Models" },
      ]);
      expect(typeSpecArray).toStrictEqual([
         { name: "Shared", kind: "alias", generics: null, isExported: true },
      ]);
   });

   it("parses decorators on classes, members and parameters", () => {
      const { typeSpecArray } = specs(`
         @entity("users")
         export class User {
            @column() id = 1;
            constructor(@inject() private readonly db: Db) {}
            @log method(@arg() value: number) {}
         }
         export @entity("x") class Other {}
      `);
      expect(typeSpecArray.map((spec) => [spec.name, spec.kind, spec.isExported])).toStrictEqual([
         ["User", "class", true],
         ["Other", "class", true],
      ]);
   });
});
