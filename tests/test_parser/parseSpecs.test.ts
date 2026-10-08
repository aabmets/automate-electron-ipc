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

import parser from "@src/parser.js";
import { describe, expect, it } from "vitest";

describe("parseSpecs", () => {
   it("should parse interfaces and types", () => {
      const { typeSpecArray } = parser.parseSpecs({
         contents: `
            export interface MyInterface {
               property: string;
            }
            export type MyType<T> = number | boolean | T;
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(typeSpecArray).toHaveLength(2);
      expect(typeSpecArray[0]).toMatchObject({
         name: "MyInterface",
         kind: "interface",
         generics: null,
         isExported: true,
      });
      expect(typeSpecArray[1]).toMatchObject({
         name: "MyType",
         kind: "type",
         generics: "<T>",
         isExported: true,
      });
   });

   it("should accept non-exported types that no channel uses", () => {
      const { typeSpecArray } = parser.parseSpecs({
         contents: `
            import { defineChannels, invoke } from "automate-electron-ipc";

            interface Hidden { secret: string }
            export interface Shown { id: number }

            export default defineChannels({
               getShown: invoke<() => Promise<Shown>>(),
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(typeSpecArray.map((spec) => [spec.name, spec.isExported])).toStrictEqual([
         ["Hidden", false],
         ["Shown", true],
      ]);
   });

   it("should reject a non-exported type that a channel uses", () => {
      const contents = `
         import { defineChannels, invoke } from "automate-electron-ipc";

         interface Hidden { secret: string }

         export default defineChannels({
            getHidden: invoke<() => Promise<Hidden>>(),
         });
      `;
      expect(() => parser.parseSpecs({ contents, relativePath: "", fullPath: "" })).toThrowError(
         "Type 'Hidden' is used by channel 'getHidden' and must be exported",
      );
   });

   it("should parse enums, classes and namespaces as local types", () => {
      const { typeSpecArray } = parser.parseSpecs({
         contents: `
            export enum Kind { A, B }
            export class Model<T> {}
            export namespace Shapes { export type Circle = { r: number } }
            declare namespace Hidden {}
            declare module "elsewhere" {}
            declare global { interface Window { x: number } }
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(typeSpecArray).toStrictEqual([
         { name: "Kind", kind: "enum", generics: null, isExported: true },
         { name: "Model", kind: "class", generics: "<T>", isExported: true },
         { name: "Shapes", kind: "namespace", generics: null, isExported: true },
         { name: "Hidden", kind: "namespace", generics: null, isExported: false },
      ]);
   });

   it("should reject a non-exported enum that a channel uses by a qualified name", () => {
      const contents = `
         import { defineChannels, send } from "automate-electron-ipc";

         enum Kind { A }

         export default defineChannels({
            setKind: send<(kind: Kind.A) => void>(),
         });
      `;
      expect(() => parser.parseSpecs({ contents, relativePath: "", fullPath: "" })).toThrowError(
         "Type 'Kind' is used by channel 'setKind' and must be exported",
      );
   });

   it("should mark a default exported interface", () => {
      const { typeSpecArray } = parser.parseSpecs({
         contents: `
            import { defineChannels, invoke } from "automate-electron-ipc";

            export default interface Payload { id: number }

            export const channels = defineChannels({
               getPayload: invoke<() => Promise<Payload>>(),
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(typeSpecArray.filter((spec) => spec.kind !== "value")).toStrictEqual([
         { name: "Payload", kind: "interface", generics: null, isExported: true, isDefault: true },
      ]);
   });

   it("should parse ES module import statements", () => {
      const { importSpecArray } = parser.parseSpecs({
         contents: `
            import type { CustomType1 } from 'module-name1';
            import { namedExport2, type CustomType2 } from 'module-name2';
            import type * as Space3 from 'module-name3';
            import * as Space4 from 'module-name4';
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(importSpecArray).toHaveLength(4);
      expect(importSpecArray[0]).toMatchObject({
         fromPath: "module-name1",
         customTypes: ["CustomType1"],
         namespace: null,
      });
      expect(importSpecArray[1]).toMatchObject({
         fromPath: "module-name2",
         customTypes: ["namedExport2", "CustomType2"],
         namespace: null,
      });
      expect(importSpecArray[2]).toMatchObject({
         fromPath: "module-name3",
         customTypes: [],
         namespace: "Space3",
      });
      expect(importSpecArray[3]).toMatchObject({
         fromPath: "module-name4",
         customTypes: [],
         namespace: "Space4",
      });
   });

   it("should parse simple unicast channels", () => {
      const { channelSpecArray, channelMapExport } = parser.parseSpecs({
         contents: `
            import { defineChannels, invoke } from "automate-electron-ipc";

            export default defineChannels({
               userChannel: invoke<(arg1: string, arg2: number) => boolean>(),
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(channelMapExport).toStrictEqual({ kind: "default" });
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "userChannel",
         kind: "Unicast",
         direction: "RendererToMain",
         signature: {
            params: [
               { name: "arg1", type: "string", rest: false, optional: false },
               { name: "arg2", type: "number", rest: false, optional: false },
            ],
            returnType: "boolean",
            customTypes: [],
            async: false,
         },
      });
   });

   it("should parse simple broadcast channels", () => {
      const { channelSpecArray, channelMapExport } = parser.parseSpecs({
         contents: `
            import { defineChannels, send } from "automate-electron-ipc";

            export const channels = defineChannels({
               userChannel: send() as (arg1: string, arg2: number) => void,
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "userChannel",
         kind: "Broadcast",
         direction: "RendererToMain",
         signature: {
            params: [
               { name: "arg1", type: "string", rest: false, optional: false },
               { name: "arg2", type: "number", rest: false, optional: false },
            ],
            returnType: "void",
            customTypes: [],
            async: false,
         },
      });
   });

   it("should parse complex unicast channels", () => {
      const { channelSpecArray } = parser.parseSpecs({
         contents: `
            import { defineChannels, invoke } from "automate-electron-ipc";

            export default defineChannels({
               userChannel: invoke<(arg1?: CustomType1<string>, ...arg2: { asd: CustomType2 }[]) => Promise<CustomType3>>(),
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "userChannel",
         kind: "Unicast",
         direction: "RendererToMain",
         signature: {
            params: [
               { name: "arg1", type: "CustomType1<string>", rest: false, optional: true },
               { name: "arg2", type: "{ asd: CustomType2 }[]", rest: true, optional: false },
            ],
            returnType: "Promise<CustomType3>",
            customTypes: ["CustomType1", "CustomType2", "CustomType3"],
            async: true,
         },
      });
   });

   it("should parse triggered emit channels and ports in one map", () => {
      const { channelSpecArray } = parser.parseSpecs({
         contents: `
            import { defineChannels, emit, port } from "automate-electron-ipc";

            export default defineChannels({
               progress: emit<(n: number) => Promise<void>>({ trigger: "focus" }),
               chat: port<(msg: CustomType) => void>(),
            });
         `,
         relativePath: "",
         fullPath: "",
      });
      expect(channelSpecArray).toHaveLength(2);
      expect(channelSpecArray[0]).toMatchObject({
         name: "progress",
         kind: "Broadcast",
         direction: "MainToRenderer",
         trigger: "focus",
         signature: { returnType: "Promise<void>", async: true },
      });
      expect(channelSpecArray[1]).toMatchObject({
         name: "chat",
         kind: "Port",
         direction: "RendererToRenderer",
         signature: { customTypes: ["CustomType"] },
      });
      expect(channelSpecArray[1]).not.toHaveProperty("trigger");
   });

   it("should ignore files which do not declare a channel map", () => {
      const out = parser.parseSpecs({
         contents: "export type Shared = { id: number };",
         relativePath: "",
         fullPath: "",
      });
      expect(out.channelSpecArray).toStrictEqual([]);
      expect(out.channelMapExport).toBeNull();
      expect(out.typeSpecArray).toHaveLength(1);
   });

   it("should name the file in schema errors", () => {
      expect(() =>
         parser.parseSpecs({
            contents: `
               import { defineChannels, invoke } from "automate-electron-ipc";
               export default defineChannels({ userChannel: invoke() });
            `,
            relativePath: "schema/user.ts",
            fullPath: "/app/src/ipc/schema/user.ts",
         }),
      ).toThrow("Schema file '/app/src/ipc/schema/user.ts': channel 'userChannel': no signature");
   });

   it("should report syntax errors with the file path, line and column", () => {
      // Regression for T08: parse errors were swallowed and reported as "no channels found".
      const parse = () =>
         parser.parseSpecs({
            contents: "const a = 1;\nexport default defineChannels({ a: ;\n});",
            relativePath: "schema/user.ts",
            fullPath: "/app/src/ipc/schema/user.ts",
         });
      expect(parse).toThrow(
         "Syntax error in schema file '/app/src/ipc/schema/user.ts:2:36': Expression expected",
      );
   });

   it("should report the editor column of a syntax error after a tab or a wide character", () => {
      const parse = (contents: string) => () =>
         parser.parseSpecs({ contents, relativePath: "s.ts", fullPath: "/p/s.ts" });
      expect(parse("\tconst b = ;")).toThrow("Syntax error in schema file '/p/s.ts:1:12'");
      expect(parse('const s = "日本"; const b = ;')).toThrow(
         "Syntax error in schema file '/p/s.ts:1:27'",
      );
   });

   it("should report the end of the input for a syntax error at the end", () => {
      expect(() =>
         parser.parseSpecs({
            contents: "const a = 1;\nconst b = ",
            relativePath: "",
            fullPath: "/p/s.ts",
         }),
      ).toThrow("Syntax error in schema file '/p/s.ts:2:11': Expression expected");
   });

   it("should fall back to the relative path when naming a file with a syntax error", () => {
      expect(() =>
         parser.parseSpecs({ contents: "const = ;", relativePath: "user.ts", fullPath: "" }),
      ).toThrow(/^Syntax error in schema file 'user\.ts:1:\d+': /);
   });

   it("should validate parsed channels", () => {
      const parse = (entries: string) =>
         parser.parseSpecs({
            contents: `
               import { defineChannels, invoke, send, emit } from "automate-electron-ipc";
               export default defineChannels({ ${entries} });
            `,
            relativePath: "",
            fullPath: "",
         });
      expect(() => parse("UpperCase: invoke<() => void>()")).toThrow(/lowercase letter/);
      expect(() => parse("sendChan: send<() => string>()")).toThrow(/not allowed/);
      expect(() => parse("same: invoke<() => void>(), same: send<() => void>()")).toThrow(
         /not unique/,
      );
   });
});

describe("parseSpecs, names of globals that the schema binds", () => {
   const parse = (contents: string) =>
      parser.parseSpecs({ contents, relativePath: "", fullPath: "" });

   // Regression for T60.
   it("collects a declared type that is named like a global", () => {
      const { channelSpecArray, typeSpecArray } = parse(`
         import { defineChannels, invoke } from "automate-electron-ipc";

         export interface Error { code: number }

         export default defineChannels({
            getError: invoke<(id: number) => Error>(),
            getDate: invoke<() => Date>(),
         });
      `);
      expect(typeSpecArray.map((spec) => spec.name)).toStrictEqual(["Error"]);
      expect(channelSpecArray.map((spec) => spec.signature.customTypes)).toStrictEqual([
         ["Error"],
         [],
      ]);
   });

   it("collects an imported type that is named like a global", () => {
      const { channelSpecArray, importSpecArray } = parse(`
         import { defineChannels, send } from "automate-electron-ipc";
         import type { Map, Set as Bag } from "./collections";

         export default defineChannels({
            put: send<(map: Map, bag: Bag, plain: Set<string>) => void>(),
         });
      `);
      expect(importSpecArray.find((spec) => spec.fromPath === "./collections")).toStrictEqual({
         fromPath: "./collections",
         customTypes: ["Map", "Set as Bag"],
         namespace: null,
      });
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual(["Map", "Bag"]);
   });

   it("collects a namespace import that is named like a global namespace", () => {
      const { channelSpecArray } = parse(`
         import { defineChannels, invoke } from "automate-electron-ipc";
         import type * as Intl from "./intl";

         export default defineChannels({
            get: invoke<() => Intl.Format>(),
         });
      `);
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual(["Intl.Format"]);
   });

   it("requires a declared type of a global name to be exported when a channel uses it", () => {
      expect(() =>
         parse(`
            import { defineChannels, invoke } from "automate-electron-ipc";

            interface Error { code: number }

            export default defineChannels({
               get: invoke<() => Error>(),
            });
         `),
      ).toThrow("Type 'Error' is used by channel 'get' and must be exported.");
   });

   it("treats the name as a global in a file that does not bind it", () => {
      const { channelSpecArray } = parse(`
         import { defineChannels, invoke } from "automate-electron-ipc";

         export default defineChannels({
            get: invoke<() => Error>(),
         });
      `);
      expect(channelSpecArray[0].signature.customTypes).toStrictEqual([]);
   });
});

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
      const module = parser.parseModule("export default class Account {}").module;
      expect([...parser.collectModuleBindings(module)]).toStrictEqual(["Account"]);
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

describe("collectModuleBindings", () => {
   const bindings = (code: string) => [
      ...parser.collectModuleBindings(parser.parseModule(code).module),
   ];

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

describe("describeSyntaxError", () => {
   it("reads the position from the caret of the code frame", () => {
      const message = [
         "  x Expression expected",
         "   ,-[2:1]",
         " 1 | const a = 1;",
         " 2 | export default f({ a: ;",
         "   :                       ^",
         " 3 | });",
         "   `----",
      ].join("\n");
      expect(parser.describeSyntaxError(new Error(message))).toStrictEqual({
         reason: "Expression expected",
         line: 2,
         column: 23,
      });
   });

   // Regression for T71: the column was read from the frame, which expands tabs and counts the
   // display width of wide characters.
   describe("with the parsed source", () => {
      const describeError = (code: string) => {
         try {
            parser.parseModule(code);
         } catch (error) {
            return parser.describeSyntaxError(error, code);
         }
         throw new Error("Expected a syntax error");
      };

      it("counts a tab as one column", () => {
         expect(describeError("\tconst b = ;")).toMatchObject({ line: 1, column: 12 });
         expect(describeError("x\t=\t;")).toMatchObject({ line: 1, column: 5 });
         expect(describeError("\t\tconst b = ;")).toMatchObject({ line: 1, column: 13 });
      });

      it("counts a wide character as one column", () => {
         expect(describeError('const s = "日本"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("counts a character outside the BMP as two columns, like an editor", () => {
         expect(describeError('const s = "😀"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("counts a combining mark as a column", () => {
         expect(describeError('const s = "e\u0301"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("reads the line of an error after several lines, with CRLF line ends", () => {
         expect(describeError("const a = 1;\r\n\r\n\tconst b = ;\r\n")).toMatchObject({
            line: 3,
            column: 12,
         });
      });

      it("does not count a BOM", () => {
         expect(describeError("\uFEFFconst b = ;")).toMatchObject({ line: 1, column: 11 });
         expect(describeError("\uFEFF\tconst b = ;")).toMatchObject({ line: 1, column: 12 });
      });

      it("gives an error at the end of the input the position of the end", () => {
         expect(describeError("const a = 1;\nconst b = ")).toMatchObject({ line: 2, column: 11 });
         expect(describeError("const a = (")).toMatchObject({ line: 1, column: 12 });
         expect(describeError("type T = ")).toMatchObject({ line: 1, column: 10 });
         expect(describeError("const a = (\n")).toMatchObject({ line: 2, column: 1 });
      });

      it("falls back to the display column when the frame does not match the source", () => {
         const message = ["  x Oops", "   ,----", " 1 | const b = ;", "   :           ^"].join(
            "\n",
         );
         expect(parser.describeSyntaxError(new Error(message), "different")).toMatchObject({
            line: 1,
            column: 11,
         });
         expect(parser.describeSyntaxError(new Error(message), "")).toMatchObject({
            line: 1,
            column: 11,
         });
      });

      it("does not invent a position for a message without a code frame", () => {
         expect(parser.describeSyntaxError(new Error("boom"), "const a = 1;")).toStrictEqual({
            reason: "boom",
         });
      });
   });

   it("falls back to the header position when there is no caret", () => {
      const message = "  x Unexpected token\n   ,-[7:3]\n";
      expect(parser.describeSyntaxError(new Error(message))).toStrictEqual({
         reason: "Unexpected token",
         line: 7,
         column: 3,
      });
   });

   it("returns only the reason when the position is unknown", () => {
      expect(parser.describeSyntaxError("boom")).toStrictEqual({ reason: "boom" });
      expect(parser.describeSyntaxError(new Error("\n"))).toStrictEqual({
         reason: "Syntax error",
      });
   });
});
