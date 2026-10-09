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

import parser from "@src/parser/parser.js";
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
