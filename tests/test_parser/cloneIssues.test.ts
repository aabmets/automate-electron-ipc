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

/** Parses the signature of `type Sig = ...` in a module that also contains `declarations`. */
function issuesOf(definition: string, declarations = ""): t.CloneIssue[] {
   const { module, src } = parser.parseModule(`${declarations}\ntype Sig = ${definition};`);
   const alias = module.body.at(-1) as any;
   const signature = parser.parseSignature(
      alias.typeAnnotation,
      src,
      parser.collectModuleBindings(module),
      parser.collectTypeDeclarations(module),
   );
   return signature.cloneIssues ?? [];
}

function errorsOf(definition: string, declarations = ""): string[] {
   return issuesOf(definition, declarations)
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.where}: ${issue.reason} ${issue.type}`);
}

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

   // Regression for T96: `Awaited` unwraps a Promise, so `Awaited<Promise<X>>` is `X`.
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
      const { module, src } = parser.parseModule(
         "type Sig = () => AsyncIterable<Promise<string>>;",
      );
      const signature = parser.parseSignature(
         (module.body[0] as any).typeAnnotation,
         src,
         parser.collectModuleBindings(module),
         parser.collectTypeDeclarations(module),
         true,
      );
      expect(signature.cloneIssues).toStrictEqual([
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

describe("cloneIssues, local types", () => {
   it("follows a type alias", () => {
      const issues = issuesOf("(cb: Callback) => void", "type Callback = () => void;");
      expect(issues).toStrictEqual([
         {
            level: "error",
            where: "parameter 'cb'",
            type: "() => void",
            reason: "a function",
            via: "Callback",
         },
      ]);
   });

   it("follows exported aliases and interfaces", () => {
      const declarations = [
         "export type Handler = { run(): void };",
         "export interface Options { onDone: Handler; name: string }",
      ].join("\n");
      expect(issuesOf("(opts: Options) => void", declarations)).toStrictEqual([
         {
            level: "error",
            where: "parameter 'opts'",
            type: "run(): void",
            reason: "a function",
            via: "Options → Handler",
         },
      ]);
   });

   it("follows interface members, bases and merged declarations", () => {
      const declarations = [
         "interface Base { key: symbol }",
         "interface Derived extends Base { name: string }",
         "interface Merged { a: string }",
         "interface Merged { b: Function }",
      ].join("\n");
      expect(errorsOf("(d: Derived) => void", declarations)).toStrictEqual([
         "parameter 'd': a symbol symbol",
      ]);
      expect(errorsOf("(m: Merged) => void", declarations)).toStrictEqual([
         "parameter 'm': a function Function",
      ]);
   });

   it("follows generic aliases and the arguments they are given", () => {
      const declarations = "type Box<T> = { value: T };\ntype Cb<T> = (x: T) => void;";
      expect(errorsOf("(b: Box<() => void>) => void", declarations)).toStrictEqual([
         "parameter 'b': a function () => void",
      ]);
      expect(errorsOf("(b: Box<string>) => void", declarations)).toStrictEqual([]);
      expect(errorsOf("(c: Cb<string>) => void", declarations)).toStrictEqual([
         "parameter 'c': a function (x: T) => void",
      ]);
   });

   it("stops at recursive types", () => {
      const declarations = [
         "type Tree = { children: Tree[]; leaf: Leaf };",
         "type Leaf = { parent: Tree; key: symbol };",
         "interface Node { next: Node | null }",
      ].join("\n");
      expect(errorsOf("(t: Tree) => void", declarations)).toStrictEqual([
         "parameter 't': a symbol symbol",
      ]);
      expect(errorsOf("(n: Node) => void", declarations)).toStrictEqual([]);
   });

   it("follows the constraint of a type parameter", () => {
      expect(errorsOf("<T extends () => void>(cb: T) => void")).toStrictEqual([
         "parameter 'cb': a function () => void",
      ]);
      expect(errorsOf("<T extends { cb: Function }>(arg: T[]) => T")).toStrictEqual([
         "parameter 'arg': a function Function",
         "return type: a function Function",
      ]);
      expect(errorsOf("<T extends string>(value: T) => T")).toStrictEqual([]);
      expect(errorsOf("<T>(value: T) => T")).toStrictEqual([]);
   });

   it("does not treat a shadowing local as the global type", () => {
      // An imported or declared WeakMap, Function or Promise is not the global one.
      const imported = 'import type { WeakMap, Function, Promise, Symbol } from "./lib";';
      expect(
         errorsOf("(a: WeakMap, b: Function, c: Promise<string>) => void", imported),
      ).toStrictEqual([]);
      expect(
         errorsOf("(a: WeakMap<string, number>) => void", "interface WeakMap<K, V> {}"),
      ).toStrictEqual([]);
   });

   it("cannot see into imported types and qualified names", () => {
      const imported = 'import type { Callback } from "./types"; import * as lib from "./lib";';
      expect(errorsOf("(a: Callback, b: lib.Callback) => void", imported)).toStrictEqual([]);
   });

   it("looks at the type arguments of a qualified name", () => {
      const imported = 'import * as lib from "./lib";';
      expect(errorsOf("(a: lib.Box<() => void>) => void", imported)).toStrictEqual([
         "parameter 'a': a function () => void",
      ]);
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
      const { module, src } = parser.parseModule("type Sig = (a: string) => void;");
      const signature = parser.parseSignature((module.body[0] as any).typeAnnotation, src);
      expect(signature).not.toHaveProperty("cloneIssues");
   });
});

describe("cloneIssues, class instances", () => {
   const warningsOf = (definition: string, declarations: string) =>
      issuesOf(definition, declarations)
         .filter((issue) => issue.level === "warning")
         .map((issue) => `${issue.where}: ${issue.reason} (${issue.type})`);

   it("warns about a class declared in the schema file", () => {
      const declarations = "class User { name = ''; greet() {} }";
      expect(warningsOf("(user: User) => void", declarations)).toStrictEqual([
         "parameter 'user': an instance of the class 'User' (User)",
      ]);
      expect(issuesOf("(user: User) => void", declarations).map((i) => i.level)).toStrictEqual([
         "warning",
      ]);
   });

   it("warns about exported, default and declared classes", () => {
      expect(warningsOf("() => A", "export class A {}")).toHaveLength(1);
      expect(warningsOf("() => B", "export default class B {}")).toHaveLength(1);
      expect(warningsOf("() => C", "declare class C {}")).toHaveLength(1);
      expect(warningsOf("() => D", "export abstract class D {}")).toHaveLength(1);
   });

   it("warns about a class in a return type, a member or a type argument", () => {
      const declarations = "class User {}\ninterface Row { owner: User }";
      expect(warningsOf("() => Promise<User>", declarations)).toStrictEqual([
         "return type: an instance of the class 'User' (User)",
      ]);
      expect(warningsOf("(rows: Row[]) => void", declarations)).toStrictEqual([
         "parameter 'rows': an instance of the class 'User' (User)",
      ]);
      expect(warningsOf("(users: Map<string, User>) => void", declarations)).toHaveLength(1);
      expect(warningsOf("(users: User[]) => void", declarations)).toHaveLength(1);
   });

   it("does not warn about interfaces, aliases, enums and imported classes", () => {
      const declarations = [
         'import { Imported } from "./lib";',
         "interface I { a: string }",
         "type A = { b: number };",
         "enum E { X }",
      ].join("\n");
      expect(issuesOf("(a: I, b: A, c: E, d: Imported) => void", declarations)).toStrictEqual([]);
   });

   it("warns about a class that is used as an alias target", () => {
      const declarations = "class User {}\ntype Owner = User;";
      expect(warningsOf("(o: Owner) => void", declarations)).toStrictEqual([
         "parameter 'o': an instance of the class 'User' (User)",
      ]);
   });
});

describe("cloneIssues, from a schema file", () => {
   const IMPORT = 'import { defineChannels, invoke, send } from "automate-electron-ipc";';

   it("reports the issues on the channel specs", () => {
      const specs = parser.parseSpecs({
         fullPath: "/p/ipc/schema.ts",
         relativePath: "schema.ts",
         contents: [
            IMPORT,
            "export class User {}",
            "export default defineChannels({",
            "   save: invoke<(user: User) => Promise<void>>(),",
            "});",
         ].join("\n"),
      });
      expect(specs.channelSpecArray[0].signature.cloneIssues).toStrictEqual([
         {
            level: "warning",
            where: "parameter 'user'",
            type: "User",
            reason: "an instance of the class 'User'",
         },
      ]);
   });

   it("fails the parse of a schema file with a Promise nested in a result", () => {
      const contents = [
         IMPORT,
         "export default defineChannels({",
         "   profile: invoke<() => Promise<{ avatar: Promise<string> }>>(),",
         "});",
      ].join("\n");
      expect(() =>
         parser.parseSpecs({ fullPath: "/p/ipc/schema.ts", relativePath: "s", contents }),
      ).toThrowError(
         "Schema file '/p/ipc/schema.ts': Channel 'profile': return type contains a Promise " +
            "('Promise<string>'). It cannot be sent over IPC. Only the result of an async " +
            "signature is a Promise, and only as the outermost type, so await it and send the " +
            "resolved value.",
      );
   });

   it("fails the parse of a schema file with an error issue", () => {
      const contents = [
         IMPORT,
         "type Done = () => void;",
         "export default defineChannels({",
         "   run: send<(done: Done, key: symbol) => void>(),",
         "});",
      ].join("\n");
      expect(() =>
         parser.parseSpecs({ fullPath: "/p/ipc/schema.ts", relativePath: "s", contents }),
      ).toThrowErrorMatchingInlineSnapshot(`
           [Error: Schema file '/p/ipc/schema.ts': Channel 'run': parameter 'done' contains a function ('() => void') through 'Done'. It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. Send plain data instead, and use a channel to call back.
           Schema file '/p/ipc/schema.ts': Channel 'run': parameter 'key' contains a symbol ('symbol'). It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. Send plain data instead, and use a channel to call back.]
         `);
   });
});
