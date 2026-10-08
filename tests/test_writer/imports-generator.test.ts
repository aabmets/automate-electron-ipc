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
});
