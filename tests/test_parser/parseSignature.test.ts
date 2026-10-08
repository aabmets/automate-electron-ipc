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
      expect(params).toMatchObject([
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

describe("parseSignature, void return types", () => {
   // Regression for T69: the check compared the text with "void" and "Promise<void>".
   it.each([
      "void",
      "(void)",
      "Promise<void>",
      "Promise< void >",
      "Promise<(void)>",
      "(Promise<void>)",
      "Promise<void /* x */>",
   ])("treats %s as void", (returnType) => {
      expect(parseSignature(`() => ${returnType}`).returnsVoid).toBe(true);
   });

   it.each([
      "string",
      "undefined",
      "never",
      "Promise<string>",
      "Promise<void | string>",
      "Promise<void[]>",
      "Promise<void, void>",
      "Promise",
      "PromiseLike<void>",
      "Foo<void>",
      "void | string",
   ])("does not treat %s as void", (returnType) => {
      expect(parseSignature(`() => ${returnType}`).returnsVoid).toBe(false);
   });

   it("does not treat a declared Promise<void> as void", () => {
      expect(parseSignature("() => Promise<void>", ["Promise"]).returnsVoid).toBe(false);
   });
});

describe("parseSignature, type references", () => {
   const refsOf = (definition: string, locals: string[] = []) => {
      const signature = parseSignature(definition, locals);
      return (signature.typeRefs ?? []).map((ref) => [
         ref.name,
         signature.definition.slice(ref.start, ref.end),
      ]);
   };

   it("records the position of every reference, ordered by position", () => {
      expect(refsOf("(a: Foo, b: Map<string, Bar>) => Baz")).toStrictEqual([
         ["Foo", "Foo"],
         ["Bar", "Bar"],
         ["Baz", "Baz"],
      ]);
   });

   it("records the head of a qualified name and of a typeof query", () => {
      expect(refsOf("(a: NS.Inner.Kind, b: typeof cfg.value) => void")).toStrictEqual([
         ["NS", "NS"],
         ["cfg", "cfg"],
      ]);
   });

   it("records references inside a template literal type, not its text", () => {
      expect(refsOf("(a: `User-${User}-${Id}`) => void")).toStrictEqual([
         ["User", "User"],
         ["Id", "Id"],
      ]);
   });

   it("records no method name, property key, parameter name or string literal", () => {
      expect(refsOf('(User: { User(): void; User: "User" }) => void')).toStrictEqual([]);
   });

   it("records no builtin type and no type parameter in scope", () => {
      expect(refsOf("<T>(a: T, b: Promise<Date>) => T")).toStrictEqual([]);
   });

   it("records a global that the schema file binds itself", () => {
      expect(refsOf("(a: Error) => void", ["Error"])).toStrictEqual([["Error", "Error"]]);
   });

   it("records where the text of the parameter types and of the return type starts", () => {
      const signature = parseSignature('(k: "é", ...rest: Foo[]) => Promise<Bar>');
      const at = (start?: number, text?: string) =>
         signature.definition.slice(start, (start ?? 0) + (text?.length ?? 0));
      expect(at(signature.params[0].typeStart, signature.params[0].type)).toBe('"é"');
      expect(at(signature.params[1].typeStart, signature.params[1].type)).toBe("Foo[]");
      expect(at(signature.returnStart, signature.returnType)).toBe("Promise<Bar>");
   });

   it("has no type start for a parameter without an annotation", () => {
      expect(parseSignature("(a) => void").params[0].typeStart).toBeUndefined();
   });
});
