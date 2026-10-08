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
