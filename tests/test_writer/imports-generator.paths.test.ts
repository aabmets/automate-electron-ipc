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

      // Everything after the last dot was stripped, "user.model" -> "user".
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
         // `.mjs` and `.cjs` stay in both modes: `./a` does not resolve to `a.mts` or `a.cts`.
         const cases: [string, string, string][] = [
            ["./a.ts", "./a", "./a.js"],
            ["./a.tsx", "./a", "./a.js"],
            ["./a.js", "./a", "./a.js"],
            ["./a.jsx", "./a", "./a.js"],
            ["./a.mts", "./a.mjs", "./a.mjs"],
            ["./a.mjs", "./a.mjs", "./a.mjs"],
            ["./a.cts", "./a.cjs", "./a.cjs"],
            ["./a.cjs", "./a.cjs", "./a.cjs"],
            ["./a.model.mts", "./a.model.mjs", "./a.model.mjs"],
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

      // "./settings.json" became "./settings.json.js" under NodeNext.
      it("adds no script extension to the specifier of a data file", () => {
         for (const fromPath of ["./settings.json", "../a/b.c.json", "./logo.svg", "./data.node"]) {
            for (const nodeNext of [false, true]) {
               expect(importOf(fromPath, nodeNext)).toStrictEqual(
                  `import type { Foo } from "${fromPath}";`,
               );
            }
         }
      });

      it("keeps the extension of a local .mts schema file in both modes", () => {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema/api.mts",
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
         for (const nodeNext of [false, true]) {
            const ig = new ImportsGenerator(nodeNext, "/project/src/autoipc/main.ts");
            expect(ig.getDeclaration(pfs, "Foo")).toStrictEqual(
               'import type { Foo } from "./schema/api.mjs";',
            );
         }
      });

      it("imports a module once, whichever of its spellings the files use", () => {
         const pfs: t.ParsedFileSpecs = {
            fullPath: "/project/src/autoipc/schema.ts",
            relativePath: "",
            specs: {
               channelSpecArray: [],
               channelMapExport: null,
               importSpecArray: [
                  { fromPath: "./a.mjs", customTypes: ["Foo"], namespace: null },
                  { fromPath: "./a.mts", customTypes: ["Foo"], namespace: null },
                  { fromPath: "./a.cjs", customTypes: ["Foo"], namespace: null },
               ],
               typeSpecArray: [],
            },
         };
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         expect(ig.getDeclaration(pfs, "Foo")).toStrictEqual('import type { Foo } from "./a.mjs";');
         // The first import of the name wins, as before: the same name is one declaration.
         expect(ig.getDeclaration(pfs, "Foo")).toBeNull();
      });

      it("rebases the path of an import type, keeping packages", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         const pfs = pfsOf("./x");
         expect(ig.getImportTypePath(pfs, "./models")).toStrictEqual("./models");
         expect(ig.getImportTypePath(pfs, "../lib/a.mts")).toStrictEqual("../lib/a.mjs");
         expect(ig.getImportTypePath(pfs, "zod")).toStrictEqual("zod");
         const nodeNext = new ImportsGenerator(true, "/project/src/autoipc/main.ts");
         expect(nodeNext.getImportTypePath(pfs, "./models")).toStrictEqual("./models.js");
         expect(nodeNext.getImportTypePath(pfs, "./data.json")).toStrictEqual("./data.json");
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

   describe("aliases of import-equals", () => {
      const alias = (name: string, aliasOf: string): t.TypeSpec => ({
         name,
         kind: "alias",
         generics: null,
         isExported: false,
         aliasOf,
      });
      const file = (
         typeSpecArray: t.TypeSpec[],
         namespaces: [string, string][] = [["Models", "./models"]],
         fullPath = "/project/src/autoipc/schema.ts",
      ): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: namespaces.map(([namespace, fromPath]) => ({
               fromPath,
               customTypes: [],
               namespace,
            })),
            typeSpecArray,
         },
      });
      const generator = () => new ImportsGenerator(false, "/project/src/autoipc/main.ts");

      it("imports the head of the target, and renames the alias to the target", () => {
         const pfs = file([alias("User", "Models.User")]);
         const ig = generator();
         expect(ig.getDeclaration(pfs, "User")).toBe('import type * as Models from "./models";');
         expect(ig.getDeclaration(pfs, "Models.User")).toBeNull();
         expect([...ig.getRenames(pfs)]).toStrictEqual([["User", "Models.User"]]);
      });

      it("follows a chain of aliases and a qualified use of an alias", () => {
         const pfs = file([alias("Point", "Shapes.Point"), alias("Shapes", "Models.Shapes")]);
         const ig = generator();
         expect(ig.getDeclaration(pfs, "Point")).toBe('import type * as Models from "./models";');
         expect(ig.getDeclaration(pfs, "Shapes.Point")).toBeNull();
         expect(Object.fromEntries(ig.getRenames(pfs))).toStrictEqual({
            Point: "Models.Shapes.Point",
            Shapes: "Models.Shapes",
         });
      });

      it("uses the local name that the namespace is imported under", () => {
         const ig = generator();
         const other = file([], [["Models", "./other"]], "/project/src/autoipc/other.ts");
         ig.getDeclaration(other, "Models");
         const pfs = file([alias("User", "Models.User")]);
         expect(ig.getDeclaration(pfs, "User")).toBe('import type * as Models_2 from "./models";');
         expect(Object.fromEntries(ig.getRenames(pfs))).toStrictEqual({
            Models: "Models_2",
            User: "Models_2.User",
         });
      });

      it("needs no import for a target that the schema file does not bind", () => {
         const pfs = file([alias("Env", "NodeJS.ProcessEnv")], []);
         const ig = generator();
         expect(ig.getDeclaration(pfs, "Env")).toBeNull();
         expect(Object.fromEntries(ig.getRenames(pfs))).toStrictEqual({ Env: "NodeJS.ProcessEnv" });
      });

      it("imports the declaration of an alias that is exported", () => {
         const exported = { ...alias("User", "Models.User"), isExported: true };
         const ig = generator();
         expect(ig.getDeclaration(file([exported]), "User")).toBe(
            'import type { User } from "./schema";',
         );
      });

      it("does not loop on aliases that refer to one another", () => {
         const pfs = file([alias("A", "B.X"), alias("B", "A.Y")], []);
         const ig = generator();
         expect(ig.getDeclaration(pfs, "A")).toBeNull();
         expect(() => ig.getRenames(pfs)).not.toThrow();
      });
   });
});

describe("ImportsGenerator, getFileImportPath", () => {
   it("writes the path of a file in the project relative to the generated file", () => {
      const ig = new ImportsGenerator(false, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/autoipc/serializer.ts")).toBe("./serializer");
      expect(ig.getFileImportPath("/p/src/lib/serializer.ts")).toBe("../lib/serializer");
      // A module script does not resolve without its extension, under any module resolution.
      expect(ig.getFileImportPath("/p/src/autoipc/util/wire.mts")).toBe("./util/wire.mjs");
      expect(ig.getFileImportPath("/p/src/autoipc/util/wire.cts")).toBe("./util/wire.cjs");
   });

   it("keeps dots that belong to the name of the file", () => {
      const ig = new ImportsGenerator(false, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/autoipc/wire.codec.ts")).toBe("./wire.codec");
   });

   it("writes the extension of the compiled file with NodeNext", () => {
      const ig = new ImportsGenerator(true, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/lib/serializer.ts")).toBe("../lib/serializer.js");
      expect(ig.getFileImportPath("/p/src/lib/serializer.mts")).toBe("../lib/serializer.mjs");
      expect(ig.getFileImportPath("/p/src/lib/serializer")).toBe("../lib/serializer.js");
   });
});
