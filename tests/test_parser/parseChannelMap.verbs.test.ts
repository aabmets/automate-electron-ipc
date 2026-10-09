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

import { parseError, parseOne } from "@testutils/channel-map-utils.js";
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule", () => {
   describe("verbs", () => {
      const verbs = [
         ["invoke", "Unicast", "RendererToMain"],
         ["send", "Broadcast", "RendererToMain"],
         ["emit", "Broadcast", "MainToRenderer"],
         ["ask", "Unicast", "MainToRenderer"],
         ["port", "Port", "RendererToRenderer"],
         ["mainPort", "Port", "MainToRenderer"],
         ["callUtility", "Unicast", "MainToUtility"],
         ["notifyUtility", "Broadcast", "MainToUtility"],
         ["callMain", "Unicast", "UtilityToMain"],
         ["notifyMain", "Broadcast", "UtilityToMain"],
         ["invokeUtility", "Unicast", "RendererToUtility"],
      ] as const;

      for (const [verb, kind, direction] of verbs) {
         describe(verb, () => {
            const expected = { name: "chan", kind, direction };

            it("parses the generic form", () => {
               const spec = parseOne(`chan: ${verb}<(a: string) => void>()`);
               expect(spec).toMatchObject(expected);
               expect(spec.signature?.definition).toBe("(a: string) => void");
            });

            it("parses the generic form with an empty config", () => {
               expect(parseOne(`chan: ${verb}<(a: string) => void>({})`)).toMatchObject(expected);
            });

            it("parses the as form", () => {
               const spec = parseOne(`chan: ${verb}() as (a: string) => void`);
               expect(spec).toMatchObject(expected);
               expect(spec.signature?.definition).toBe("(a: string) => void");
            });

            it("parses the as form with an empty config", () => {
               const spec = parseOne(`chan: ${verb}({}) as (a: string) => void`);
               expect(spec).toMatchObject(expected);
            });

            it("gives both forms the same spec", () => {
               const generic = parseOne(`chan: ${verb}<(a: Foo, b?: number) => void>()`);
               const alternative = parseOne(`chan: ${verb}() as (a: Foo, b?: number) => void`);
               expect(alternative).toStrictEqual(generic);
            });
         });
      }
   });

   describe("this parameters", () => {
      // Regression for T69: the wrappers declared `this` as an ordinary parameter (TS2680).
      it("rejects a this parameter in the generic and the as form", () => {
         const message =
            "Schema file 'schema.ts': channel 'chan': " +
            "a 'this' parameter is not supported, since IPC does not transfer 'this'.";
         expect(
            parseError(
               "export default defineChannels({ chan: send<(this: Foo, a: string) => void>() });",
            ),
         ).toBe(message);
         expect(
            parseError("export default defineChannels({ chan: send() as (this: Foo) => void });"),
         ).toBe(message);
      });

      it("accepts a parameter that is merely called thisArg", () => {
         const spec = parseOne("chan: send<(thisArg: Foo) => void>()");
         expect(spec.signature?.params.map((param) => param.name)).toStrictEqual(["thisArg"]);
      });
   });

   describe("signatures", () => {
      it("parses params, return type and custom types", () => {
         const spec = parseOne("chan: invoke<(a: string, b: Foo<Bar>[]) => Baz>()");
         expect(spec.signature).toMatchObject({
            definition: "(a: string, b: Foo<Bar>[]) => Baz",
            paramsStart: 1,
            params: [
               { name: "a", type: "string", rest: false, optional: false },
               { name: "b", type: "Foo<Bar>[]", rest: false, optional: false },
            ],
            returnType: "Baz",
            customTypes: ["Foo", "Bar", "Baz"],
            async: false,
         });
      });

      it("detects an async return type", () => {
         const spec = parseOne("chan: invoke<(id: number) => Promise<User>>()");
         expect(spec.signature).toMatchObject({
            returnType: "Promise<User>",
            customTypes: ["User"],
            async: true,
         });
      });

      it("parses a signature without params", () => {
         const spec = parseOne("chan: invoke<() => number>()");
         expect(spec.signature).toMatchObject({ params: [], returnType: "number", async: false });
      });

      it("parses optional and rest params", () => {
         const spec = parseOne("chan: send<(a: string, b?: number, ...rest: Foo[]) => void>()");
         expect(spec.signature?.params).toMatchObject([
            { name: "a", type: "string", rest: false, optional: false },
            { name: "b", type: "number", rest: false, optional: true },
            { name: "rest", type: "Foo[]", rest: true, optional: false },
         ]);
      });

      it("parses destructured params", () => {
         const spec = parseOne("chan: send<({ abc }: Foo, [x, y]: Bar) => void>()");
         expect(spec.signature?.params).toMatchObject([
            { name: "{ abc }", type: "Foo", rest: false, optional: false },
            { name: "[x, y]", type: "Bar", rest: false, optional: false },
         ]);
      });

      it("parses the same signature from the as form", () => {
         const spec = parseOne("chan: invoke() as (a?: string, ...rest: Foo[]) => Promise<Bar>");
         expect(spec.signature).toMatchObject({
            params: [
               { name: "a", type: "string", rest: false, optional: true },
               { name: "rest", type: "Foo[]", rest: true, optional: false },
            ],
            returnType: "Promise<Bar>",
            customTypes: ["Foo", "Bar"],
            async: true,
         });
      });

      it("unwraps parentheses around the as expression and its signature", () => {
         for (const entry of [
            "chan: (invoke() as (a: string) => void)",
            "chan: (invoke()) as (a: string) => void",
            "chan: invoke() as ((a: string) => void)",
            "chan: (invoke<(a: string) => void>())",
            "chan: invoke<((a: string) => void)>()",
         ]) {
            const spec = parseOne(entry);
            expect(spec.signature?.definition).toBe("(a: string) => void");
         }
      });
   });
});
