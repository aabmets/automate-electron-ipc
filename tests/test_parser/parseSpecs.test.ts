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
