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
});
