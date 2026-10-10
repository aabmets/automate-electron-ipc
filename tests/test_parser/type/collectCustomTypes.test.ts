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

import { forEachChild, parseModule } from "@src/parser/ast.js";
import { isBuiltinType } from "@src/parser/type/builtin-types.js";
import { collectCustomTypes as collectTypes } from "@src/parser/type/type-references.js";
import { describe, expect, it } from "vitest";

function collectCustomTypes(code: string, locals: string[] = []): Set<string> {
   const { module, src } = parseModule(code);
   const set = new Set<string>();
   forEachChild(module, (node) => {
      collectTypes(node, src, set, new Set(), new Set(locals));
   });
   return set;
}

describe("collectCustomTypes", () => {
   it("should not collect any types when no types are defined", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg1, arg2, arg3) => void;
      `);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should not collect any builtin types", () => {
      [
         "string",
         "number",
         "boolean",
         "void",
         "any",
         "unknown",
         "null",
         "undefined",
         "never",
         "object",
         "Function",
      ].forEach((typeName) => {
         expect(isBuiltinType(typeName)).toStrictEqual(true);
         const customTypes = collectCustomTypes(`
            const x = type as (arg: ${typeName}) => ${typeName};
         `);
         expect(customTypes).toStrictEqual(new Set());
      });
   });

   it("should not collect global types", () => {
      [
         "Array<string>",
         "Record<string, number>",
         "Map<string, number>",
         "Set<string>",
         "Date",
         "Uint8Array",
         "Partial<string>",
         "Promise<ArrayBuffer>",
      ].forEach((typeName) => {
         const customTypes = collectCustomTypes(`
            const x = type as (arg: ${typeName}) => void;
         `);
         expect(customTypes).toStrictEqual(new Set());
      });
   });

   // A name that the schema binds itself is not the global of that name.
   it("should collect a global name that the schema file binds itself", () => {
      const customTypes = collectCustomTypes(
         `const x = type as (a: Error, b: Map<string, Date>, c: Intl.Thing) => Promise<void>;`,
         ["Error", "Map", "Intl"],
      );
      expect(customTypes).toStrictEqual(new Set(["Error", "Map", "Intl.Thing"]));
   });

   it("should not collect a bound name that a type parameter hides", () => {
      const customTypes = collectCustomTypes(`const x = type as <Error>(a: Error) => void;`, [
         "Error",
      ]);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should keep treating the type keywords as built in", () => {
      const customTypes = collectCustomTypes(`const x = type as (a: string) => void;`, ["string"]);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should collect the custom types that global types wrap", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: Map<Key, Array<Value>>) => Record<string, Result>;
      `);
      expect(customTypes).toStrictEqual(new Set(["Key", "Value", "Result"]));
   });

   it("should not collect the type parameters of a generic function type", () => {
      const customTypes = collectCustomTypes(`
         const x = type as <T, U extends Bound = Fallback>(a: T, b: U[]) => Promise<T | Other>;
      `);
      expect(customTypes).toStrictEqual(new Set(["Bound", "Fallback", "Other"]));
   });

   it("should not collect the type parameters of nested generic function types", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (cb: <T>(value: T) => T[], other: T) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["T"]));
   });

   it("should not collect the key of a mapped type", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: { [P in keyof Source]: P | Extra }) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["Source", "Extra"]));
   });

   it("should not collect infer names of a conditional type", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: Input extends (infer U)[] ? U : Fallback) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["Input", "Fallback"]));
   });

   it("should collect custom types from return type literals", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg) => CustomType;
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });

   it("should collect custom types from param type literals", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: CustomType) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });

   it("should collect custom type array definitions", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: CustomType1[]) => CustomType2[];
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType1", "CustomType2"]));
   });

   it("should collect custom types from type unions", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: CustomType1 | CustomType2) => CustomType2 | CustomType3;
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType1", "CustomType2", "CustomType3"]));
   });

   it("should collect custom types from type intersections", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: CustomType1 & CustomType2) => CustomType2 & CustomType3;
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType1", "CustomType2", "CustomType3"]));
   });

   it("should collect custom types from inlined object types", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: { abc: CustomType1 }) => { def: CustomType2 };
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType1", "CustomType2"]));
   });

   // `{ abc: renamed }` binds `renamed`, it is not a type annotation.
   it("should not collect the bindings of destructured params", () => {
      const customTypes = collectCustomTypes(`
         const x = type as ({ abc: renamed, def }: CustomType) => void
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });

   it("should collect qualified names whole", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (a: Kind.A, b: NS.Inner.Deep[]) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["Kind.A", "NS.Inner.Deep"]));
   });

   it("should not collect qualified names of global namespaces", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (a: Intl.DateTimeFormat) => void;
      `);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should collect the head of a typeof query", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (a: typeof config, b: typeof ns.sub.value, c: keyof typeof table) => void;
      `);
      expect(customTypes).toStrictEqual(new Set(["config", "ns", "table"]));
   });

   it("should not collect a typeof query of a type parameter", () => {
      const customTypes = collectCustomTypes(`
         const x = type as <T>(a: T, b: typeof T) => void;
      `);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should not collect a typeof import query", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (a: typeof import("./mod")) => void;
      `);
      expect(customTypes).toStrictEqual(new Set());
   });

   it("should collect custom types from destructured object literal typehints", () => {
      const customTypes = collectCustomTypes(`
         const x = type as ({ abc }: CustomType) => void
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });

   it("should not collect generics from argument and return custom types", () => {
      const customTypes = collectCustomTypes(`
         const x = type as (arg: CustomType1<string>) => CustomType2<number>
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType1", "CustomType2"]));
   });

   it("should collect custom types from named types import syntax", () => {
      const customTypes = collectCustomTypes(`
         import type { CustomType } from 'module-name';
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });

   it("should collect a type-only import that is named like a global", () => {
      const customTypes = collectCustomTypes(`import type { Error, Date } from 'module-name';`);
      expect(customTypes).toStrictEqual(new Set(["Error", "Date"]));
   });

   it("should collect custom types from objects and named types import syntax", () => {
      const customTypes = collectCustomTypes(`
         import { namedExport, type CustomType } from 'module-name';
      `);
      expect(customTypes).toStrictEqual(new Set(["CustomType"]));
   });
});
