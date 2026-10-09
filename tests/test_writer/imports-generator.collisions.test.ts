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

import { ImportsGenerator } from "@src/writer/imports-generator.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("ImportsGenerator", () => {
   describe("names that collide across schema files", () => {
      const sigOf = (...customTypes: string[]) =>
         ({
            customTypes,
            definition: "",
            returnType: "void",
            params: [],
            async: false,
         }) as t.CallableSignature;
      const fileOf = (
         fullPath: string,
         specs: Partial<t.SpecsCollection>,
         ...usedTypes: string[]
      ): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: {
            channelSpecArray: [{ name: "chan", signature: sigOf(...usedTypes) } as t.ChannelSpec],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [],
            ...specs,
         },
      });
      const ownType = (name: string): t.TypeSpec => ({
         name,
         kind: "interface" as t.TypeKind,
         generics: null,
         isExported: true,
      });
      const importOf = (fromPath: string, ...customTypes: string[]): t.ImportSpec => ({
         fromPath,
         customTypes,
         namespace: null,
      });
      const generator = () => new ImportsGenerator(false, "/project/src/autoipc/main.ts");
      const dir = "/project/src/autoipc/schema";

      // Regression for T53: both files generated `import type { User }` (TS2300).
      it("imports types of the same name that two files declare under distinct names", () => {
         const a = fileOf(`${dir}/a.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const b = fileOf(`${dir}/b.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const ig = generator();

         expect([...ig.getRenames(a)]).toStrictEqual([]);
         expect([...ig.getRenames(b)]).toStrictEqual([["User", "User_2"]]);
         expect(ig.getDeclaration(a, "User")).toStrictEqual(
            'import type { User } from "./schema/a";',
         );
         expect(ig.getDeclaration(b, "User")).toStrictEqual(
            'import type { User as User_2 } from "./schema/b";',
         );
         expect(ig.getDeclaration(b, "User")).toBeNull();
      });

      // Regression for T53: the declaration of b.ts was dropped, its channels used the import.
      it("imports an imported type and a declared type of the same name under distinct names", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { importSpecArray: [importOf("../types/m", "User")] },
            "User",
         );
         const b = fileOf(`${dir}/b.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const ig = generator();

         expect(ig.getDeclaration(a, "User")).toStrictEqual(
            'import type { User } from "./types/m";',
         );
         expect(ig.getDeclaration(b, "User")).toStrictEqual(
            'import type { User as User_2 } from "./schema/b";',
         );
         expect([...ig.getRenames(b)]).toStrictEqual([["User", "User_2"]]);
      });

      it("imports a declaration once, however its module is spelled", () => {
         const spellings = ["../types/m", "../types/m.ts", "../types/m.js"];
         const files = spellings.map((from, index) =>
            fileOf(`${dir}/f${index}.ts`, { importSpecArray: [importOf(from, "User")] }, "User"),
         );
         const ig = generator();

         expect(ig.getDeclaration(files[0], "User")).toStrictEqual(
            'import type { User } from "./types/m";',
         );
         for (const file of files) {
            expect(ig.getDeclaration(file, "User")).toBeNull();
            expect(ig.getRenames(file).size).toBe(0);
         }
      });

      it("imports a declaration that files import under different names once", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { importSpecArray: [importOf("../m", "Foo as Bar")] },
            "Bar",
         );
         const b = fileOf(`${dir}/b.ts`, { importSpecArray: [importOf("../m", "Foo")] }, "Foo");
         const ig = generator();

         expect(ig.getDeclaration(a, "Bar")).toStrictEqual(
            'import type { Foo as Bar } from "./m";',
         );
         expect(ig.getDeclaration(b, "Foo")).toBeNull();
         expect([...ig.getRenames(b)]).toStrictEqual([["Foo", "Bar"]]);
      });

      it("imports the type of a schema file that another file imports once", () => {
         const a = fileOf(`${dir}/a.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const b = fileOf(`${dir}/b.ts`, { importSpecArray: [importOf("./a", "User")] }, "User");
         const ig = generator();

         expect(ig.getDeclaration(a, "User")).toStrictEqual(
            'import type { User } from "./schema/a";',
         );
         expect(ig.getDeclaration(b, "User")).toBeNull();
      });

      it("tells a default export from a named export of the same name", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { importSpecArray: [importOf("../m", "default as Foo")] },
            "Foo",
         );
         const b = fileOf(`${dir}/b.ts`, { importSpecArray: [importOf("../m", "Foo")] }, "Foo");
         const ig = generator();

         expect(ig.getDeclaration(a, "Foo")).toStrictEqual(
            'import type { default as Foo } from "./m";',
         );
         expect(ig.getDeclaration(b, "Foo")).toStrictEqual(
            'import type { Foo as Foo_2 } from "./m";',
         );
      });

      it("imports namespaces of the same alias from different modules under distinct aliases", () => {
         const nsOf = (fromPath: string): t.ImportSpec => ({
            fromPath,
            customTypes: [],
            namespace: "NS",
         });
         const a = fileOf(`${dir}/a.ts`, { importSpecArray: [nsOf("../one")] }, "NS.Item");
         const b = fileOf(`${dir}/b.ts`, { importSpecArray: [nsOf("../two")] }, "NS.Item");
         const c = fileOf(`${dir}/c.ts`, { importSpecArray: [nsOf("../one")] }, "NS.Other");
         const ig = generator();

         expect(ig.getDeclaration(a, "NS.Item")).toStrictEqual('import type * as NS from "./one";');
         expect(ig.getDeclaration(b, "NS.Item")).toStrictEqual(
            'import type * as NS_2 from "./two";',
         );
         expect([...ig.getRenames(b)]).toStrictEqual([["NS", "NS_2"]]);
         expect(ig.getDeclaration(c, "NS.Other")).toBeNull();
         expect(ig.getRenames(c).size).toBe(0);
      });

      it("skips alias names that are taken", () => {
         const a = fileOf(`${dir}/a.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const b = fileOf(`${dir}/b.ts`, { typeSpecArray: [ownType("User_2")] }, "User_2");
         const c = fileOf(`${dir}/c.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const ig = generator();

         expect(ig.getDeclaration(a, "User")).toContain("{ User }");
         expect(ig.getDeclaration(b, "User_2")).toContain("{ User_2 }");
         expect(ig.getDeclaration(c, "User")).toContain("{ User as User_3 }");
      });

      // Regression for T59: a schema type named like a declaration of the generated file clashed.
      it("imports a type that is named like a reserved name under an alias", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { typeSpecArray: [ownType("BrowserWindow")] },
            "BrowserWindow",
         );
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts", ["BrowserWindow"]);

         expect(ig.getRenames(a).get("BrowserWindow")).toBe("BrowserWindow_2");
         expect(ig.getDeclaration(a, "BrowserWindow")).toBe(
            'import type { BrowserWindow as BrowserWindow_2 } from "./schema/a";',
         );
      });

      it("renames an imported type that is named like a reserved name", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { importSpecArray: [importOf("../types/m", "Window", "Other as IpcMainEvent")] },
            "Window",
            "IpcMainEvent",
         );
         const ig = new ImportsGenerator(false, "/project/src/autoipc/window.d.ts", [
            "Window",
            "IpcMainEvent",
         ]);

         expect(ig.getDeclaration(a, "Window")).toBe(
            'import type { Window as Window_2 } from "./types/m";',
         );
         expect(ig.getDeclaration(a, "IpcMainEvent")).toBe(
            'import type { Other as IpcMainEvent_2 } from "./types/m";',
         );
         expect(Object.fromEntries(ig.getRenames(a))).toStrictEqual({
            Window: "Window_2",
            IpcMainEvent: "IpcMainEvent_2",
         });
      });

      it("renames a namespace import that is named like a reserved name", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            { importSpecArray: [{ fromPath: "../types/m", customTypes: [], namespace: "Window" }] },
            "Window.Item",
         );
         const ig = new ImportsGenerator(false, "/project/src/autoipc/window.d.ts", ["Window"]);

         expect(ig.getDeclaration(a, "Window.Item")).toBe(
            'import type * as Window_2 from "./types/m";',
         );
      });

      // Regression for T60: the schema's own `Error` and `Map` must be imported, not left global.
      it("imports types that are named like globals under their own names", () => {
         const a = fileOf(
            `${dir}/a.ts`,
            {
               typeSpecArray: [ownType("Error")],
               importSpecArray: [importOf("../types/m", "Map", "Set as Bag")],
            },
            "Error",
            "Map",
            "Bag",
         );
         const ig = generator();

         expect(ig.getDeclaration(a, "Error")).toBe('import type { Error } from "./schema/a";');
         expect(ig.getDeclaration(a, "Map")).toBe('import type { Map } from "./types/m";');
         expect(ig.getDeclaration(a, "Bag")).toBe('import type { Set as Bag } from "./types/m";');
         expect(ig.getRenames(a).size).toBe(0);
      });

      it("keeps the names that are not reserved", () => {
         const a = fileOf(`${dir}/a.ts`, { typeSpecArray: [ownType("User")] }, "User");
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts", ["BrowserWindow"]);

         expect(ig.getRenames(a).size).toBe(0);
         expect(ig.getDeclaration(a, "User")).toBe('import type { User } from "./schema/a";');
      });

      it("has no renames for a file whose types do not collide", () => {
         const a = fileOf(`${dir}/a.ts`, { typeSpecArray: [ownType("User")] }, "User", "Unknown");
         expect(generator().getRenames(a).size).toBe(0);
      });
   });
});
