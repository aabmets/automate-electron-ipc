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
import type * as t from "@types";
import { describe, expect, it } from "vitest";

function parseSignature(definition: string): t.CallableSignature {
   const { module, src } = parser.parseModule(`type T = ${definition};`);
   const alias = module.body[0] as any;
   return parser.parseSignature(alias.typeAnnotation, src);
}

describe("parseSignature, async detection", () => {
   it.each(["Promise<void>", "Promise<string[]>", "Promise<Promise<number>>", "(Promise<void>)"])(
      "treats the global %s as async",
      (returnType) => {
         expect(parseSignature(`() => ${returnType}`).async).toBe(true);
      },
   );

   // Regression for T56: the check was `returnType.startsWith("Promise")`.
   it.each([
      "PromiseResult",
      "PromiseLike<string>",
      "Promises",
      "Namespace.Promise<void>",
      "Awaited<Promise<void>>",
      "Promise<void> | undefined",
      "number",
      "void",
   ])("does not treat %s as async", (returnType) => {
      expect(parseSignature(`() => ${returnType}`).async).toBe(false);
   });

   it("keeps the return type text as written", () => {
      expect(parseSignature("() => PromiseResult").returnType).toBe("PromiseResult");
      expect(parseSignature("(a: string) => Promise<void>").returnType).toBe("Promise<void>");
   });
});

describe("parseSignature, parameters", () => {
   it("reads names, types, rest and optional flags", () => {
      const { params } = parseSignature("(a: string, b?: number, ...rest: boolean[]) => void");
      expect(params).toStrictEqual([
         { name: "a", type: "string", rest: false, optional: false },
         { name: "b", type: "number", rest: false, optional: true },
         { name: "rest", type: "boolean[]", rest: true, optional: false },
      ]);
   });

   it("keeps destructuring patterns as the parameter name", () => {
      const { params } = parseSignature("({ x, y }: Point, [a, b]: [number, number]) => void");
      expect(params.map((param) => param.name)).toStrictEqual(["{ x, y }", "[a, b]"]);
   });
});
