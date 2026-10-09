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

describe("parseSpecs, export specifiers and default classes", () => {
   const header = 'import { defineChannels, invoke } from "automate-electron-ipc";\n';
   const parse = (contents: string) =>
      parser.parseSpecs({ contents: header + contents, relativePath: "", fullPath: "" });
   const channels = (...types: string[]) =>
      `export default defineChannels({ ${types.map((x, i) => `chan${i}: invoke<() => ${x}>()`).join(", ")} });`;

   // Regression for T61: `interface X {}` + `export { X }` failed with "must be exported".
   it("accepts a type that `export { X }` exports", () => {
      const { typeSpecArray } = parse(`interface X {}\nexport { X };\n${channels("X")}`);
      expect(typeSpecArray).toStrictEqual([
         { name: "X", kind: "interface", generics: null, isExported: true },
      ]);
   });

   it("accepts a type that `export type { X }` exports", () => {
      const { typeSpecArray } = parse(`type X = string;\nexport type { X };\n${channels("X")}`);
      expect(typeSpecArray[0]).toMatchObject({ name: "X", isExported: true });
   });

   it("records the name of a renamed export", () => {
      const { typeSpecArray } = parse(`interface X {}\nexport { X as Y };\n${channels("X")}`);
      expect(typeSpecArray).toStrictEqual([
         { name: "X", kind: "interface", generics: null, isExported: true, exportedAs: "Y" },
      ]);
   });

   it("records `export { X as default }` and `export default X` as default exports", () => {
      for (const form of ["export { X as default };", "export default X;"]) {
         const { typeSpecArray } = parse(`interface X {}\n${form}\n${channels("X")}`);
         expect(typeSpecArray[0]).toMatchObject({ isExported: true, isDefault: true });
         expect(typeSpecArray[0]).not.toHaveProperty("exportedAs");
      }
   });

   it("prefers the export under the type's own name", () => {
      const { typeSpecArray } = parse(`interface X {}\nexport { X as Y, X };\n${channels("X")}`);
      expect(typeSpecArray[0]).not.toHaveProperty("exportedAs");
      expect(typeSpecArray[0]).not.toHaveProperty("isDefault");
   });

   it("keeps the first of several renamed exports", () => {
      const { typeSpecArray } = parse(
         `interface X {}\nexport { X as B, X as A };\n${channels("X")}`,
      );
      expect(typeSpecArray[0]).toMatchObject({ exportedAs: "B" });
   });

   it("exports every declaration that shares the name", () => {
      const { typeSpecArray } = parse(`interface X {}\nnamespace X {}\nexport { X };`);
      expect(typeSpecArray.map((spec) => spec.isExported)).toStrictEqual([true, true]);
   });

   it("ignores re-exports", () => {
      const { typeSpecArray } = parse(
         `interface X {}\nexport { X as Z } from "./other";\nexport * from "./more";`,
      );
      expect(typeSpecArray).toStrictEqual([
         { name: "X", kind: "interface", generics: null, isExported: false },
      ]);
   });

   it("still requires a type to be exported when a channel uses it", () => {
      expect(() => parse(`interface X {}\nexport { Y };\n${channels("X")}`)).toThrow(
         "Type 'X' is used by channel 'chan0' and must be exported.",
      );
   });

   it("records a default exported class", () => {
      const { typeSpecArray, channelSpecArray } = parse(
         `export default class Account<T> { id!: T }\n${channels("Account<number>").replace("export default", "export const channels =")}`,
      );
      expect(typeSpecArray.filter((spec) => spec.kind !== "value")).toStrictEqual([
         {
            name: "Account",
            kind: "class",
            generics: "<T>",
            isExported: true,
            isDefault: true,
         },
      ]);
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual(["Account"]);
   });

   it("ignores an anonymous default exported class", () => {
      const { typeSpecArray } = parse("export default class {}");
      expect(typeSpecArray).toStrictEqual([]);
   });

   it("binds the name of a default exported class", () => {
      const module = parseModule("export default class Account {}").module;
      expect([...collectModuleBindings(module)]).toStrictEqual(["Account"]);
   });
});

describe("parseSpecs, typeof of values declared in the schema file", () => {
   const header = 'import { defineChannels, invoke } from "automate-electron-ipc";\n';
   const parse = (contents: string) =>
      parser.parseSpecs({ contents: header + contents, relativePath: "", fullPath: "" });
   const using = (name: string) =>
      `export default defineChannels({ get: invoke<(current: typeof ${name}) => void>() });`;
   const values = (contents: string) =>
      parse(contents).typeSpecArray.filter((spec) => spec.kind === "value");
   const value = (name: string, isExported: boolean, extra = {}) => ({
      name,
      kind: "value",
      generics: null,
      isExported,
      ...extra,
   });

   // Regression for T62: `typeof x` of a value declared in the schema file was never imported.
   it("records the exported values that a signature queries", () => {
      const { typeSpecArray, channelSpecArray } = parse(
         `export const config = { a: 1 };\n${using("config")}`,
      );
      expect(typeSpecArray).toStrictEqual([value("config", true)]);
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual(["config"]);
   });

   it("records variables, functions and their modifiers", () => {
      expect(
         values(`
            const a = 1;
            let b = 2;
            export var c = 3;
            function d() {}
            export async function* e() {}
            export declare const f: number;
            declare function g(): void;
         `),
      ).toStrictEqual([
         value("a", false),
         value("b", false),
         value("c", true),
         value("d", false),
         value("e", true),
         value("f", true),
         value("g", false),
      ]);
   });

   it("records every name of a declaration list and of destructuring patterns", () => {
      expect(
         values(
            `export const a = 1, { b, c: [d, , ...e], f = 2, ...g } = o, [[h], { i: j } = k] = p;`,
         ).map((spec) => spec.name),
      ).toStrictEqual(["a", "b", "d", "e", "f", "g", "h", "j"]);
   });

   it("records the overloads of a function", () => {
      const names = values(`export function f(): void;\nexport function f(x?: number) {}`);
      expect(names.map((spec) => spec.name)).toStrictEqual(["f", "f"]);
   });

   it("records a default exported function, and ignores an anonymous one", () => {
      expect(values("export default function main() {}")).toStrictEqual([
         value("main", true, { isDefault: true }),
      ]);
      expect(values("export default async function () {}")).toStrictEqual([]);
   });

   it("exports values through export specifiers", () => {
      expect(
         values("const a = 1, b = 2, c = 3;\nexport { a, b as renamed };\nexport default c;"),
      ).toStrictEqual([
         value("a", true),
         value("b", true, { exportedAs: "renamed" }),
         value("c", true, { isDefault: true }),
      ]);
   });

   it("ignores values of nested scopes and of other statements", () => {
      expect(
         values(`
            function outer() { const inner = 1; }
            namespace N { export const inside = 1; }
            class C { prop = 1; }
            if (true) { var hoisted = 1; }
         `).map((spec) => spec.name),
      ).toStrictEqual(["outer"]);
   });

   it("requires a queried value to be exported", () => {
      for (const declaration of ["const config = 1;", "function config() {}"]) {
         expect(() => parse(`${declaration}\n${using("config")}`)).toThrow(
            "Value 'config' is used by channel 'get' through 'typeof config' and must be exported. " +
               "Add 'export' to its declaration.",
         );
      }
   });

   it("accepts a queried value that is exported later", () => {
      const { typeSpecArray, channelSpecArray } = parse(
         `const config = 1;\nexport { config };\n${using("config")}`,
      );
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual(["config"]);
      expect(typeSpecArray).toMatchObject([{ name: "config", kind: "value", isExported: true }]);
   });

   it("does not require values that no signature queries", () => {
      const { typeSpecArray } = parse(`const unused = 1;\n${using("unused2")}`);
      expect(typeSpecArray).toMatchObject([{ name: "unused", kind: "value", isExported: false }]);
   });

   it("queries the head of a qualified name", () => {
      expect(() => parse(`const config = { key: 1 };\n${using("config.key")}`)).toThrow(
         "Value 'config' is used by channel 'get'",
      );
   });
});
