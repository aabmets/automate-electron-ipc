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

function parseSignature(definition: string, locals: string[] = []): t.CallableSignature {
   const { module, src } = parser.parseModule(`type T = ${definition};`);
   const alias = module.body[0] as any;
   return parser.parseSignature(alias.typeAnnotation, src, new Set(locals));
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

describe("parseSignature, names that the schema file binds", () => {
   // Regression for T60.
   it("collects a global name that the schema file binds itself", () => {
      const { customTypes } = parseSignature("(e: Error, d: Date) => Map<string, X>", [
         "Error",
         "Map",
      ]);
      expect(customTypes).toStrictEqual(["Error", "Map", "X"]);
   });

   it("does not treat a declared Promise as async", () => {
      expect(parseSignature("() => Promise<void>", ["Promise"]).async).toBe(false);
      expect(parseSignature("() => Promise<void>").async).toBe(true);
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

describe("parseSignature, start of the parameter list", () => {
   const restAfterParen = (definition: string) => {
      const { definition: text, paramsStart } = parseSignature(definition);
      return text.slice(paramsStart);
   };

   it("points just after the opening parenthesis", () => {
      expect(restAfterParen("(a: string) => void")).toBe("a: string) => void");
      expect(restAfterParen("() => void")).toBe(") => void");
   });

   // Regression for T57: the first `(` of the text belonged to a constraint of a type parameter.
   it("skips the type parameters of generic signatures", () => {
      expect(restAfterParen("<T extends (x: number) => void>(cb: T) => void")).toBe(
         "cb: T) => void",
      );
      expect(restAfterParen("<T, U = (a: T) => T>() => U")).toBe(") => U");
   });

   it("skips comments between the type parameters and the parameter list", () => {
      expect(restAfterParen("<T>/* ( */(a: T) => void")).toBe("a: T) => void");
      expect(restAfterParen("<T>// (\n(a: T) => void")).toBe("a: T) => void");
   });
});
