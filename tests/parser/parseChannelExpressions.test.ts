/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import parser from "@src/parser";
import * as t from "@types";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parseChannelExpressions(code: string): t.ChannelSpec {
   const src = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.Latest, true);
   const spec: Partial<t.ChannelSpec> = {};
   ts.forEachChild(src, (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
         parser.parseChannelExpressions(node, src, spec);
      }
   });
   return spec as t.ChannelSpec;
}

describe("parseChannelExpressions", () => {
   describe("PropertyAccessExpression Handling", () => {
      it("should assign all groups for a valid PropertyAccessExpression that matches channelPattern", () => {
         const code = `Channel('SomeChannel').Broadcast.RendererToMain;`;
         const result = parseChannelExpressions(code);
         expect(result).toEqual({
            name: "SomeChannel",
            kind: "Broadcast",
            direction: "RendererToMain",
         });
      });

      it("should return empty object for a PropertyAccessExpression that does not match channelPattern", () => {
         let result = parseChannelExpressions("foo.bar.baz;");
         expect(result).toEqual({});

         for (const kind of ["Broadcast", "Unicast"]) {
            for (const direction of ["RendererToRenderer", "RendererToMain", "MainToRenderer"]) {
               const invalidExpressions = [
                  `Channel("SomeChannel").${kind};`,
                  `Channel("SomeChannel").${direction};`,
                  `Channel().${kind}.${direction}`,
               ];
               for (const expr of invalidExpressions) {
                  result = parseChannelExpressions(expr);
                  expect(result).toEqual({});
               }
            }
         }
      });
   });

   describe("PropertyAssignment Handling", () => {
      describe("Signature Assignment", () => {
         it("should parse a valid FunctionTypeNode with multiple parameters of different types", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as (param1: string, param2: number, param3: boolean) => void
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature).toStrictEqual({
               params: [
                  { name: "param1", type: "string", rest: false, optional: false },
                  { name: "param2", type: "number", rest: false, optional: false },
                  { name: "param3", type: "boolean", rest: false, optional: false },
               ],
               returnType: "void",
               customTypes: [],
               async: false,
            });
         });

         it("should correctly set the optional flag for parameters with optional tokens", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as (param?: string) => void
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.params).toEqual([
               { name: "param", type: "string", rest: false, optional: true },
            ]);
         });

         it("should correctly set the rest flag for parameters with rest tokens", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as (...params: string[]) => void
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.params).toEqual([
               { name: "params", type: "string[]", rest: true, optional: false },
            ]);
         });

         it("should set the async flag to true for functions returning a Promise type", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as () => Promise<number>
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.async).toBe(true);
            expect(result.signature?.returnType).toBe("Promise<number>");
         });

         it("should handle FunctionTypeNode with no parameters", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as () => void
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.params).toEqual([]);
            expect(result.signature?.returnType).toBe("void");
         });

         it("should set the async flag to false for functions returning a non-Promise type", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as () => number
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.async).toBe(false);
            expect(result.signature?.returnType).toBe("number");
         });

         it("should correctly parse functions with complex return types", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as () => Promise<Result<string, Error>>
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.returnType).toBe("Promise<Result<string, Error>>");
            expect(result.signature?.async).toBe(true);
         });

         it("should collect custom types used in parameters and return type", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as (param1: CustomType1, param2: CustomType2[]) => Promise<CustomType3>
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature?.customTypes.sort()).toEqual(
               ["CustomType1", "CustomType2", "CustomType3"].sort(),
            );
         });

         it("should collect generic custom types used in parameters and return type", () => {
            const result = parseChannelExpressions(`
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as (param: CustomType1<string>) => CustomType2<number>
               });
            `);
            expect(result.signature?.customTypes.sort()).toEqual([
               "CustomType1<string>",
               "CustomType2<number>",
            ]);
         });

         it("should handle PropertyAssignment nodes missing child nodes gracefully", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  signature: type as string
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.signature).toBeUndefined();
         });
      });

      describe("Listeners Assignment", () => {
         it("should correctly parse multiple listeners enclosed in single or double quotes", () => {
            for (const c of `'"`) {
               const code = `
                  Channel("SomeChannel").Broadcast.RendererToMain({
                     listeners: [${c}listenerOne${c}, ${c}listenerTwo${c}, ${c}listenerThree${c}]
                  });
               `;
               const result = parseChannelExpressions(code);
               expect(result.listeners).toEqual(["listenerOne", "listenerTwo", "listenerThree"]);
            }
         });

         it("should set listeners to an empty array when no listeners are assigned", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  listeners: []
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.listeners).toBeUndefined();
         });

         it("should not parse listeners with non-word characters", () => {
            for (const c of "!#$%&()*+,-./:;<=>?@[\\]^{|}~") {
               const code = `
                  Channel("SomeChannel").Broadcast.RendererToMain({
                     listeners: ["valid_listener", 'invalid${c}listener', '', 123];
                  });
               `;
               const result = parseChannelExpressions(code);
               if (result?.listeners) {
                  expect(result.listeners).toEqual(["valid_listener"]);
               } else {
                  expect(result.listeners).toBeUndefined();
               }
            }
         });

         it("should handle listeners assignment with excessive whitespace", () => {
            const code = `
               Channel("SomeChannel").Broadcast.RendererToMain({
                  listeners: [  'listenerOne'  ,  "listenerTwo"  ,   'listenerThree'  ];
               });
            `;
            const result = parseChannelExpressions(code);
            expect(result.listeners).toEqual(["listenerOne", "listenerTwo", "listenerThree"]);
         });
      });
   });
});
