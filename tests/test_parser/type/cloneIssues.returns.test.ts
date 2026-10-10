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

import { errorsOf, issuesOf } from "@testutils/parser/clone-issues-utils.js";
import { describe, expect, it } from "vitest";

describe("cloneIssues, return types", () => {
   it.each([
      ["a function", "() => () => void"],
      ["Function", "() => Function"],
      ["symbol", "() => symbol"],
      ["WeakMap", "() => WeakMap<object, number>"],
      ["WeakSet", "() => WeakSet<object>"],
      ["a member", "() => { run: () => void }"],
      ["an array", "() => symbol[]"],
      ["a union", "() => string | Function"],
      ["an async result", "() => Promise<() => void>"],
      ["a nested async result", "() => Promise<{ items: symbol[] }>"],
      ["a parenthesized Promise", "() => (Promise<symbol>)"],
   ])("rejects %s", (_name, definition) => {
      const issues = issuesOf(definition);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ level: "error", where: "return type" });
   });

   it("allows the Promise of an async signature, but not a Promise inside it", () => {
      expect(issuesOf("() => Promise<string>")).toStrictEqual([]);
      expect(issuesOf("() => Promise<void>")).toStrictEqual([]);
      expect(issuesOf("(a: number) => Promise<string[]>")).toStrictEqual([]);
   });

   // Only the Promise of an async signature may be in the result, and Electron cannot clone a
   // Promise anywhere below it, as it cannot clone one in a parameter.
   it.each([
      ["a Promise in the async result", "() => Promise<{ avatar: Promise<string> }>"],
      ["a Promise in the Promise", "() => Promise<Promise<string>>"],
      ["an array of Promises", "() => Promise<number>[]"],
      ["a generic array of Promises", "() => Array<Promise<number>>"],
      ["a Promise in a sync result", "() => { avatar: Promise<string> }"],
      ["a Promise in a tuple", "() => [string, Promise<number>]"],
      ["a Promise in an async array", "() => Promise<Promise<string>[]>"],
      ["a Promise in a Map", "() => Map<string, Promise<number>>"],
      ["a Promise in an async union", "() => Promise<string | Promise<number>>"],
      ["a Promise in an intersection", "() => Promise<string> & { a: number }"],
      ["a Promise below a sync union member", "() => string | { a: Promise<number> }"],
      ["a Promise below a parenthesized Promise", "() => (Promise<{ a: Promise<number> }>)"],
   ])("rejects %s", (_name, definition) => {
      const issues = issuesOf(definition);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
         level: "error",
         where: "return type",
         reason: "a Promise",
      });
   });

   it("allows the Promise of a sync union with its sync type, and an alias of it", () => {
      expect(issuesOf("() => Promise<string> | string")).toStrictEqual([]);
      expect(issuesOf("() => string | (Promise<string> | undefined)")).toStrictEqual([]);
      expect(issuesOf("() => Done", "type Done = Promise<string>;")).toStrictEqual([]);
      expect(issuesOf("() => Done", "type Done = Promise<string> | null;")).toStrictEqual([]);
   });

   it("reports a Promise below the outermost one, also through a local alias", () => {
      expect(errorsOf("() => Done", "type Done = Promise<{ a: Promise<string> }>;")).toStrictEqual([
         "return type: a Promise Promise<string>",
      ]);
      expect(errorsOf("() => Box<Promise<string>>", "type Box<T> = { value: T };")).toStrictEqual([
         "return type: a Promise Promise<string>",
      ]);
      expect(errorsOf("() => Row", "interface Row { later: Promise<string> }")).toStrictEqual([
         "return type: a Promise Promise<string>",
      ]);
   });

   // `Awaited` unwraps a Promise, so `Awaited<Promise<X>>` is `X`.
   it.each([
      ["a result", "() => Awaited<Promise<string>>"],
      ["a nested Promise", "() => Awaited<Promise<Promise<string>>>"],
      ["a PromiseLike", "() => Awaited<PromiseLike<string>>"],
      ["a union", "() => Awaited<Promise<string> | number>"],
      ["a parenthesized Promise", "() => Awaited<(Promise<string>)>"],
      ["an async signature", "() => Promise<Awaited<Promise<string>>>"],
      ["a parameter", "(value: Awaited<Promise<string>>) => void"],
      ["a nested parameter", "(list: Awaited<Promise<string>>[]) => void"],
      ["a bare Promise", "() => Awaited<Promise>"],
   ])("allows Awaited of a Promise as %s", (_name, definition) => {
      expect(issuesOf(definition)).toStrictEqual([]);
   });

   it("allows Awaited of a local alias of a Promise", () => {
      expect(issuesOf("() => Awaited<Done>", "type Done = Promise<string>;")).toStrictEqual([]);
      expect(issuesOf("(v: Awaited<Done>) => void", "type Done = Promise<string>;")).toStrictEqual(
         [],
      );
   });

   // Awaited unwraps the outermost Promise only: what it resolves to is checked as usual.
   it.each([
      ["a function", "() => Awaited<Promise<() => void>>", "a function"],
      ["a symbol", "(v: Awaited<Promise<symbol>>) => void", "a symbol"],
      ["a Promise in an object", "() => Awaited<Promise<{ a: Promise<string> }>>", "a Promise"],
      ["a Promise in an array", "() => Awaited<Promise<string>[]>", "a Promise"],
      ["a Promise in a Map", "() => Awaited<Map<string, Promise<number>>>", "a Promise"],
      [
         "a Promise in a parameter object",
         "(o: Awaited<{ a: Promise<string> }>) => void",
         "a Promise",
      ],
      ["a Promise in a type argument", "() => Awaited<Box<Promise<string>>>", "a Promise"],
      ["a symbol", "() => Awaited<symbol>", "a symbol"],
   ])("still reports %s inside Awaited", (_name, definition, reason) => {
      const issues = issuesOf(definition, "type Box<T> = { value: T };");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ level: "error", reason });
   });

   it("does not let Awaited hide a Promise beside it", () => {
      expect(errorsOf("(a: Awaited<Promise<string>>, b: Promise<string>) => void")).toStrictEqual([
         "parameter 'b': a Promise Promise<string>",
      ]);
      expect(errorsOf("() => Awaited<Promise<string>>[] | Promise<number>[]")).toStrictEqual([
         "return type: a Promise Promise<number>",
      ]);
   });

   it("does not treat a declared Awaited as the global one", () => {
      expect(
         errorsOf("(v: Awaited<Promise<string>>) => void", "type Awaited<T> = T;"),
      ).toStrictEqual(["parameter 'v': a Promise Promise<string>"]);
   });

   // A PromiseLike is a Promise in practice: allowed as the result, reported anywhere else.
   it("allows a PromiseLike as the result, also in a union with the sync type", () => {
      expect(issuesOf("() => PromiseLike<string>")).toStrictEqual([]);
      expect(issuesOf("() => PromiseLike<string> | string")).toStrictEqual([]);
      expect(issuesOf("() => Done", "type Done = PromiseLike<string>;")).toStrictEqual([]);
   });

   it.each([
      ["a parameter", "(pending: PromiseLike<string>) => void", "parameter 'pending'"],
      ["an object in a parameter", "(o: { p: PromiseLike<string> }) => void", "parameter 'o'"],
      ["an array in a result", "() => PromiseLike<string>[]", "return type"],
      ["an object in a result", "() => { p: PromiseLike<string> }", "return type"],
      ["a PromiseLike in a Promise", "() => Promise<PromiseLike<string>>", "return type"],
      ["a Promise in a PromiseLike", "() => PromiseLike<Promise<string>>", "return type"],
   ])("reports a PromiseLike as %s", (_name, definition, where) => {
      const issues = issuesOf(definition);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ level: "error", where, reason: "a Promise" });
   });

   it("still reports what a PromiseLike resolves to", () => {
      expect(errorsOf("() => PromiseLike<symbol>")).toStrictEqual(["return type: a symbol symbol"]);
   });

   it("reports a Promise in the chunks of a stream", () => {
      expect(issuesOf("() => AsyncIterable<Promise<string>>", "", true)).toStrictEqual([
         {
            level: "error",
            where: "chunk type",
            type: "Promise<string>",
            reason: "a Promise",
         },
      ]);
   });

   it("allows a bare Promise return type", () => {
      expect(issuesOf("() => Promise")).toStrictEqual([]);
   });
});
