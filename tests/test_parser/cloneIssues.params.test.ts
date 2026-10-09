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

import { parseModule } from "@src/ast.js";
import { parseSignature } from "@src/signature.js";
import { errorsOf, issuesOf } from "@testutils/clone-issues-utils.js";
import { describe, expect, it } from "vitest";

describe("cloneIssues, forbidden types in parameters", () => {
   it.each([
      ["a function type", "(cb: () => void) => void", "parameter 'cb': a function () => void"],
      [
         "a function type with parameters",
         "(cb: (x: number, y: string) => boolean) => void",
         "parameter 'cb': a function (x: number, y: string) => boolean",
      ],
      [
         "a parenthesized function type",
         "(cb: (() => void) | undefined) => void",
         "parameter 'cb': a function () => void",
      ],
      [
         "a constructor type",
         "(ctor: new () => Date) => void",
         "parameter 'ctor': a function new () => Date",
      ],
      ["Function", "(cb: Function) => void", "parameter 'cb': a function Function"],
      ["symbol", "(key: symbol) => void", "parameter 'key': a symbol symbol"],
      [
         "WeakMap",
         "(map: WeakMap<object, string>) => void",
         "parameter 'map': a WeakMap WeakMap<object, string>",
      ],
      ["WeakSet", "(set: WeakSet<object>) => void", "parameter 'set': a WeakSet WeakSet<object>"],
      [
         "Promise",
         "(pending: Promise<string>) => void",
         "parameter 'pending': a Promise Promise<string>",
      ],
   ])("rejects %s", (_name, definition, expected) => {
      expect(errorsOf(definition)).toStrictEqual([expected]);
   });

   it("rejects a unique symbol", () => {
      expect(errorsOf("(key: unique symbol) => void")).toStrictEqual([
         "parameter 'key': a symbol unique symbol",
      ]);
   });

   it("names every offending parameter and keeps the order", () => {
      expect(errorsOf("(a: symbol, ok: string, b: Function) => void")).toStrictEqual([
         "parameter 'a': a symbol symbol",
         "parameter 'b': a function Function",
      ]);
   });

   it("rejects rest and optional parameters", () => {
      expect(errorsOf("(...cbs: Array<() => void>) => void")).toStrictEqual([
         "parameter 'cbs': a function () => void",
      ]);
      expect(errorsOf("(cb?: () => void) => void")).toStrictEqual([
         "parameter 'cb': a function () => void",
      ]);
   });
});

describe("cloneIssues, nested members", () => {
   it.each([
      ["an object property", "(o: { run: () => void }) => void"],
      ["an object method", "(o: { run(): void }) => void"],
      ["an object call signature", "(o: { (): void }) => void"],
      ["a deep object property", "(o: { a: { b: { c: symbol } } }) => void"],
      ["an array", "(list: (() => void)[]) => void"],
      ["a generic array", "(list: Array<symbol>) => void"],
      ["a readonly array", "(list: readonly Function[]) => void"],
      ["a tuple", "(pair: [string, () => void]) => void"],
      ["an optional tuple member", "(pair: [string, symbol?]) => void"],
      ["a union", "(value: string | symbol) => void"],
      ["an intersection", "(value: { a: string } & { b: Function }) => void"],
      ["a Map value", "(map: Map<string, () => void>) => void"],
      ["a Set element", "(set: Set<symbol>) => void"],
      ["a Record value", "(rec: Record<string, WeakSet<object>>) => void"],
      ["a Partial", "(rec: Partial<{ cb: () => void }>) => void"],
      ["an index signature", "(rec: { [key: string]: () => void }) => void"],
      ["a getter", "(o: { get cb(): () => void }) => void"],
      ["a Promise in an object", "(o: { pending: Promise<string> }) => void"],
      ["a Promise in an array", "(list: Promise<string>[]) => void"],
      ["a Promise in a Map", "(map: Map<string, Promise<number>>) => void"],
      ["a branch of a conditional type", "(v: boolean extends true ? () => void : string) => void"],
      ["an indexed access object", '(v: { cb: string }["cb"] | (() => void)[][0]) => void'],
   ])("rejects %s", (_name, definition) => {
      expect(errorsOf(definition)).toHaveLength(1);
   });

   it("reports the nested type and not the container", () => {
      expect(errorsOf("(o: { a: { b: string[]; c: () => void } }) => void")).toStrictEqual([
         "parameter 'o': a function () => void",
      ]);
   });

   it("reports a repeated offending type once per place", () => {
      expect(errorsOf("(v: symbol | symbol | { a: symbol }) => void")).toStrictEqual([
         "parameter 'v': a symbol symbol",
      ]);
   });

   it("looks into the arguments of generic types", () => {
      expect(errorsOf("(v: Awaited<symbol>) => void")).toHaveLength(1);
      expect(errorsOf("(v: Readonly<Record<string, Function>>) => void")).toHaveLength(1);
   });
});

describe("cloneIssues, types that are fine", () => {
   it.each([
      "(a: string, b: number, c: boolean, d: bigint, e: null, f: undefined) => void",
      "(a: Date, b: RegExp, c: Error, d: Uint8Array, e: ArrayBuffer) => void",
      "(a: Map<string, number>, b: Set<string[]>, c: Record<string, { n: number }>) => void",
      "(a: { x: number; y?: string[] }, b: [string, number], c: 'a' | 'b') => void",
      "(a: unknown, b: any, c: never, d: object) => void",
      "(key: keyof { a: string }) => void",
      "(key: `item-${string}`) => void",
      "(a: Partial<{ n: number }>, b: Pick<{ a: 1; b: 2 }, 'a'>) => void",
      "(a: Omit<{ a: string; cb: () => void }, 'cb'>) => void",
      "(args: Parameters<(x: number) => void>) => void",
      "(r: ReturnType<() => string>) => void",
      "(v: Exclude<string | number, Function>) => void",
      "(v: Exclude<string | Function, Function>) => void",
      "(v: Extract<string | symbol, string>) => void",
      "(v: NonNullable<string | null>) => void",
      "<T>(v: T extends (...args: any[]) => infer R ? R : never) => void",
      "(v: typeof globalThis) => void",
      "(v: import('./x').Y) => void",
      "() => void",
      "() => Promise<Date>",
   ])("accepts %s", (definition) => {
      expect(issuesOf(definition)).toStrictEqual([]);
   });

   it("leaves out the field when there is nothing to report", () => {
      const { module, src } = parseModule("type Sig = (a: string) => void;");
      const signature = parseSignature((module.body[0] as any).typeAnnotation, src);
      expect(signature).not.toHaveProperty("cloneIssues");
   });
});
