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

import { parseSpecs } from "@src/parser/parser.js";
import { errorsOf, issuesOf } from "@testutils/parser/clone-issues-utils.js";
import { describe, expect, it } from "vitest";

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
      const specs = parseSpecs({
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
         parseSpecs({ fullPath: "/p/ipc/schema.ts", relativePath: "s", contents }),
      ).toThrowError(
         "Schema file '/p/ipc/schema.ts' (3:4): Channel 'profile': return type contains a Promise " +
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
         parseSpecs({ fullPath: "/p/ipc/schema.ts", relativePath: "s", contents }),
      ).toThrowErrorMatchingInlineSnapshot(`
           [Error: Schema file '/p/ipc/schema.ts' (4:4): Channel 'run': parameter 'done' contains a function ('() => void') through 'Done'. It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. Send plain data instead, and use a channel to call back.
           Schema file '/p/ipc/schema.ts' (4:4): Channel 'run': parameter 'key' contains a symbol ('symbol'). It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. Send plain data instead, and use a channel to call back.]
         `);
   });
});
