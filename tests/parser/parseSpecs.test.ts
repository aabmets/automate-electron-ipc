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
import { describe, expect, it } from "vitest";

describe("parseSpecs", () => {
   it("should parse interfaces and types", () => {
      const { typeSpecArray } = parser.parseSpecs(`
         export interface MyInterface {
            property: string;
         }
         type MyType<T> = number | boolean | T;
      `);
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
         isExported: false,
      });
   });

   it("should parse ES module import statements", () => {
      const { importSpecArray } = parser.parseSpecs(`
         import defaultExport1 from "module-name1";
         import { namedExport2 } from 'module-name2';
         import type { CustomType3 } from 'module-name3';
         import { namedExport4, type CustomType4 } from 'module-name4';
         import type * as Space5 from 'module-name5';
         import * as Space6 from 'module-name6';
      `);
      expect(importSpecArray).toHaveLength(5);
      expect(importSpecArray[0]).toMatchObject({
         fromPath: "module-name2",
         customTypes: [],
         namespace: null,
      });
      expect(importSpecArray[1]).toMatchObject({
         fromPath: "module-name3",
         customTypes: ["CustomType3"],
         namespace: null,
      });
      expect(importSpecArray[2]).toMatchObject({
         fromPath: "module-name4",
         customTypes: ["CustomType4"],
         namespace: null,
      });
      expect(importSpecArray[3]).toMatchObject({
         fromPath: "module-name5",
         customTypes: [],
         namespace: "Space5",
      });
      expect(importSpecArray[4]).toMatchObject({
         fromPath: "module-name6",
         customTypes: [],
         namespace: "Space6",
      });
   });

   it("should parse simple unicast channel expressions", () => {
      const { channelSpecArray } = parser.parseSpecs(`
         Channel("UserChannel").Unicast.RendererToMain({
            signature: type as (arg1: string, arg2: number) => boolean,
         })
      `);
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "UserChannel",
         kind: "Unicast",
         direction: "RendererToMain",
         signature: {
            params: [
               {
                  name: "arg1",
                  type: "string",
                  rest: false,
                  optional: false,
               },
               {
                  name: "arg2",
                  type: "number",
                  rest: false,
                  optional: false,
               },
            ],
            returnType: "boolean",
            customTypes: [],
            async: false,
         },
      });
   });

   it("should parse simple broadcast channel expressions", () => {
      const { channelSpecArray } = parser.parseSpecs(`
         Channel("UserChannel").Broadcast.RendererToMain({
            signature: type as (arg1: string, arg2: number) => boolean,
            listeners: ["onUserChannel_Handler1", "onUserChannel_Handler2"],
         })
      `);
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "UserChannel",
         kind: "Broadcast",
         direction: "RendererToMain",
         listeners: ["onUserChannel_Handler1", "onUserChannel_Handler2"],
         signature: {
            params: [
               {
                  name: "arg1",
                  type: "string",
                  rest: false,
                  optional: false,
               },
               {
                  name: "arg2",
                  type: "number",
                  rest: false,
                  optional: false,
               },
            ],
            returnType: "boolean",
            customTypes: [],
            async: false,
         },
      });
   });

   it("should parse complex unicast channel expressions", () => {
      const { channelSpecArray } = parser.parseSpecs(`
         Channel("UserChannel").Unicast.RendererToRenderer({
            signature: type as (arg1?: CustomType1<string>, ...arg2: { asd: CustomType2 }[] ) => Promise<CustomType3>,
         })
      `);
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "UserChannel",
         kind: "Unicast",
         direction: "RendererToRenderer",
         signature: {
            params: [
               {
                  name: "arg1",
                  type: "CustomType1<string>",
                  rest: false,
                  optional: true,
               },
               {
                  name: "arg2",
                  type: "{ asd: CustomType2 }[]",
                  rest: true,
                  optional: false,
               },
            ],
            returnType: "Promise<CustomType3>",
            customTypes: ["CustomType1", "CustomType2", "CustomType3"],
            async: true,
         },
      });
   });

   it("should parse complex broadcast channel expressions", () => {
      const { channelSpecArray } = parser.parseSpecs(`
         Channel("UserChannel").Broadcast.MainToRenderer({
            signature: type as (arg1?: CustomType1<string>, ...arg2: { asd: CustomType2 }[] ) => Promise<CustomType3>,
            listeners: ["onUserChannel_Handler1", "onUserChannel_Handler2"],
         })
      `);
      expect(channelSpecArray).toHaveLength(1);
      expect(channelSpecArray[0]).toMatchObject({
         name: "UserChannel",
         kind: "Broadcast",
         direction: "MainToRenderer",
         listeners: ["onUserChannel_Handler1", "onUserChannel_Handler2"],
         signature: {
            params: [
               {
                  name: "arg1",
                  type: "CustomType1<string>",
                  rest: false,
                  optional: true,
               },
               {
                  name: "arg2",
                  type: "{ asd: CustomType2 }[]",
                  rest: true,
                  optional: false,
               },
            ],
            returnType: "Promise<CustomType3>",
            customTypes: ["CustomType1", "CustomType2", "CustomType3"],
            async: true,
         },
      });
   });
});
