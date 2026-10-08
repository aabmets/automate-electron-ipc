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
   it("generates valid import statement for types internal to the IPC schema", () => {
      for (const ext of ["", ".js"]) {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema/index.ts",
            relativePath: "",
            specs: {
               channelSpecArray: [],
               importSpecArray: [],
               typeSpecArray: [
                  {
                     name: "CustomType",
                     kind: "interface" as t.TypeKind,
                     generics: null,
                     isExported: true,
                  },
               ],
            },
         };
         const ig = new ImportsGenerator(ext === ".js", "/project/src/autoipc/main.ts");
         const dec = ig.getDeclaration(pfs, "CustomType");
         expect(dec).toStrictEqual(`import type { CustomType } from "./schema/index${ext}";`);
      }
   });

   it("imports a default exported type of the IPC schema as the default export", () => {
      const pfs: t.ParsedFileSpecs = {
         fullPath: "/project/src/autoipc/schema.ts",
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [
               {
                  name: "Payload",
                  kind: "interface" as t.TypeKind,
                  generics: null,
                  isExported: true,
                  isDefault: true,
               },
            ],
         },
      };
      const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
      expect(ig.getDeclaration(pfs, "Payload")).toStrictEqual(
         'import type { default as Payload } from "./schema";',
      );
   });

   it("imports a type of the IPC schema only once", () => {
      const pfs: t.ParsedFileSpecs = {
         fullPath: "/project/src/autoipc/schema.ts",
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [
               { name: "Local", kind: "type" as t.TypeKind, generics: null, isExported: true },
            ],
         },
      };
      const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
      expect(ig.getDeclaration(pfs, "Local")).toStrictEqual(
         'import type { Local } from "./schema";',
      );
      expect(ig.getDeclaration(pfs, "Local")).toBeNull();
   });

   it("generates valid import statement for types external to the IPC schema", () => {
      for (const ext of ["", ".js"]) {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema/index.ts",
            relativePath: "",
            specs: {
               channelSpecArray: [],
               importSpecArray: [
                  {
                     fromPath: "../../../types/ipc",
                     customTypes: ["CustomType"],
                     namespace: null,
                  },
               ],
               typeSpecArray: [],
            },
         };
         const ig = new ImportsGenerator(ext === ".js", "/project/src/autoipc/main.ts");
         const dec = ig.getDeclaration(pfs, "CustomType");
         expect(dec).toStrictEqual(`import type { CustomType } from "../../types/ipc${ext}";`);
      }
   });

   it("generates valid import statement for namespace type imports", () => {
      for (const ext of ["", ".js"]) {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema/index.ts",
            relativePath: "",
            specs: {
               channelSpecArray: [],
               importSpecArray: [
                  {
                     fromPath: "./types/ipc",
                     customTypes: [],
                     namespace: "Space",
                  },
               ],
               typeSpecArray: [],
            },
         };
         const ig = new ImportsGenerator(ext === ".js", "/project/src/autoipc/main.ts");
         const dec = ig.getDeclaration(pfs, "Space.CustomType");
         expect(dec).toStrictEqual(`import type * as Space from "./schema/types/ipc${ext}";`);
      }
   });

   describe("imports recorded from the schema file", () => {
      const pfsOf = (...importSpecArray: t.ImportSpec[]): t.ParsedFileSpecs => ({
         fullPath: "/project/src/autoipc/schema/index.ts",
         relativePath: "",
         specs: { channelSpecArray: [], importSpecArray, typeSpecArray: [] },
      });
      const generator = () => new ImportsGenerator(false, "/project/src/autoipc/main.ts");

      it("imports an aliased name from its exported name", () => {
         const pfs = pfsOf({ fromPath: "./a", customTypes: ["Foo as Bar"], namespace: null });
         expect(generator().getDeclaration(pfs, "Bar")).toStrictEqual(
            'import type { Foo as Bar } from "./schema/a";',
         );
      });

      it("does not match an alias by its exported name", () => {
         const pfs = pfsOf({ fromPath: "./a", customTypes: ["Foo as Bar"], namespace: null });
         expect(generator().getDeclaration(pfs, "Foo")).toBeNull();
      });

      it("imports a default import as the default export", () => {
         const pfs = pfsOf({ fromPath: "./a", customTypes: ["default as Foo"], namespace: null });
         expect(generator().getDeclaration(pfs, "Foo")).toStrictEqual(
            'import type { default as Foo } from "./schema/a";',
         );
      });

      it("keeps package specifiers as they are", () => {
         for (const nodeNext of [false, true]) {
            const pfs = pfsOf({
               fromPath: "electron",
               customTypes: ["Rectangle"],
               namespace: null,
            });
            const ig = new ImportsGenerator(nodeNext, "/project/src/autoipc/main.ts");
            expect(ig.getDeclaration(pfs, "Rectangle")).toStrictEqual(
               'import type { Rectangle } from "electron";',
            );
         }
      });

      it("imports a name only once", () => {
         const pfs = pfsOf({ fromPath: "./a", customTypes: ["Foo"], namespace: null });
         const ig = generator();
         expect(ig.getDeclaration(pfs, "Foo")).not.toBeNull();
         expect(ig.getDeclaration(pfs, "Foo")).toBeNull();
      });
   });

   describe("import paths", () => {
      const pfsOf = (fromPath: string): t.ParsedFileSpecs => ({
         fullPath: "/project/src/autoipc/schema.ts",
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: [{ fromPath, customTypes: ["Foo"], namespace: null }],
            typeSpecArray: [],
         },
      });
      const importOf = (fromPath: string, nodeNext: boolean) =>
         new ImportsGenerator(nodeNext, "/project/src/autoipc/main.ts").getDeclaration(
            pfsOf(fromPath),
            "Foo",
         );

      // Regression for T55: everything after the last dot was stripped, "user.model" -> "user".
      it("keeps dots that belong to the file name", () => {
         expect(importOf("./types/user.model", false)).toStrictEqual(
            'import type { Foo } from "./types/user.model";',
         );
         expect(importOf("./types/user.model", true)).toStrictEqual(
            'import type { Foo } from "./types/user.model.js";',
         );
         expect(importOf("./api.v2", false)).toStrictEqual('import type { Foo } from "./api.v2";');
         expect(importOf("../shared/a.b.c", true)).toStrictEqual(
            'import type { Foo } from "../shared/a.b.c.js";',
         );
      });

      it("strips script extensions, and maps them to the compiled extension for NodeNext", () => {
         const cases: [string, string, string][] = [
            ["./a.ts", "./a", "./a.js"],
            ["./a.tsx", "./a", "./a.js"],
            ["./a.js", "./a", "./a.js"],
            ["./a.jsx", "./a", "./a.js"],
            ["./a.mts", "./a", "./a.mjs"],
            ["./a.mjs", "./a", "./a.mjs"],
            ["./a.cts", "./a", "./a.cjs"],
            ["./a.cjs", "./a", "./a.cjs"],
            ["./a.model.ts", "./a.model", "./a.model.js"],
            ["./a", "./a", "./a.js"],
         ];
         for (const [fromPath, plain, nodeNext] of cases) {
            expect(importOf(fromPath, false)).toStrictEqual(`import type { Foo } from "${plain}";`);
            expect(importOf(fromPath, true)).toStrictEqual(
               `import type { Foo } from "${nodeNext}";`,
            );
         }
      });

      it("keeps the dots of the name of a local schema file", () => {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema/user.model.ts",
            relativePath: "",
            specs: {
               channelSpecArray: [],
               channelMapExport: null,
               importSpecArray: [],
               typeSpecArray: [
                  { name: "Foo", kind: "type" as t.TypeKind, generics: null, isExported: true },
               ],
            },
         };
         const ig = new ImportsGenerator(true, "/project/src/autoipc/main.ts");
         expect(ig.getDeclaration(pfs, "Foo")).toStrictEqual(
            'import type { Foo } from "./schema/user.model.js";',
         );
      });
   });

   describe("qualified names and typeof queries", () => {
      const pfsOf = (specs: Partial<t.SpecsCollection>): t.ParsedFileSpecs => ({
         fullPath: "/project/src/autoipc/schema.ts",
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [],
            ...specs,
         },
      });
      const generator = () => new ImportsGenerator(false, "/project/src/autoipc/main.ts");

      // Regression for T54: `Kind.A` was only resolved against namespace imports.
      it("imports a named import by the head of a qualified name", () => {
         const pfs = pfsOf({
            importSpecArray: [{ fromPath: "./kind", customTypes: ["Kind"], namespace: null }],
         });
         const ig = generator();
         expect(ig.getDeclaration(pfs, "Kind.A")).toStrictEqual(
            'import type { Kind } from "./kind";',
         );
         expect(ig.getDeclaration(pfs, "Kind.B")).toBeNull();
         expect(ig.getDeclaration(pfs, "Kind")).toBeNull();
      });

      it("imports an aliased named import by the head of a qualified name", () => {
         const pfs = pfsOf({
            importSpecArray: [{ fromPath: "./kind", customTypes: ["Kind as K"], namespace: null }],
         });
         expect(generator().getDeclaration(pfs, "K.A.B")).toStrictEqual(
            'import type { Kind as K } from "./kind";',
         );
      });

      it("imports a local type by the head of a qualified name", () => {
         const pfs = pfsOf({
            typeSpecArray: [
               { name: "Kind", kind: "enum" as t.TypeKind, generics: null, isExported: true },
            ],
         });
         expect(generator().getDeclaration(pfs, "Kind.A")).toStrictEqual(
            'import type { Kind } from "./schema";',
         );
      });

      it("imports a namespace that is used without a member", () => {
         const pfs = pfsOf({
            importSpecArray: [{ fromPath: "./ns", customTypes: [], namespace: "NS" }],
         });
         expect(generator().getDeclaration(pfs, "NS")).toStrictEqual(
            'import type * as NS from "./ns";',
         );
      });

      it("imports nothing for a head that the schema does not declare", () => {
         expect(generator().getDeclaration(pfsOf({}), "Missing.A")).toBeNull();
      });
   });

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

   describe("namespace imports", () => {
      const nsSpec: t.ImportSpec = { fromPath: "./t", customTypes: [], namespace: "NS" };
      const pfsOf = (extra: Partial<t.SpecsCollection> = {}): t.ParsedFileSpecs => ({
         fullPath: "/project/src/autoipc/schema/index.ts",
         relativePath: "",
         specs: { channelSpecArray: [], importSpecArray: [nsSpec], typeSpecArray: [], ...extra },
      });
      const generator = () => new ImportsGenerator(false, "/project/src/autoipc/main.ts");

      it("imports the namespace once for several types from it", () => {
         const ig = generator();
         expect(ig.getDeclaration(pfsOf(), "NS.A")).toStrictEqual(
            'import type * as NS from "./schema/t";',
         );
         expect(ig.getDeclaration(pfsOf(), "NS.B")).toBeNull();
      });

      it("does not import anything for a namespace the schema does not import", () => {
         expect(generator().getDeclaration(pfsOf(), "Other.A")).toBeNull();
      });

      it("does not resolve a namespaced type through a local type or a named import", () => {
         const specs = {
            importSpecArray: [nsSpec, { fromPath: "./u", customTypes: ["B"], namespace: null }],
            typeSpecArray: [
               { name: "B", kind: "type" as t.TypeKind, generics: null, isExported: true },
            ],
         };
         const ig = generator();
         ig.getDeclaration(pfsOf(specs), "NS.A");
         expect(ig.getDeclaration(pfsOf(specs), "NS.B")).toBeNull();
      });
   });
});
