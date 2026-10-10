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

      // `Kind.A` was only resolved against namespace imports.
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

      // `typeof config` of a value declared in the schema file got no import.
      it("imports a value of the schema file that a typeof query refers to", () => {
         const pfs = pfsOf({
            typeSpecArray: [
               { name: "config", kind: "value" as t.TypeKind, generics: null, isExported: true },
            ],
         });
         const ig = generator();
         expect(ig.getDeclaration(pfs, "config")).toStrictEqual(
            'import type { config } from "./schema";',
         );
         expect(ig.getDeclaration(pfs, "config")).toBeNull();
      });

      it("imports a renamed and a default exported value of the schema file", () => {
         const pfs = pfsOf({
            typeSpecArray: [
               {
                  name: "config",
                  kind: "value" as t.TypeKind,
                  generics: null,
                  isExported: true,
                  exportedAs: "settings",
               },
               {
                  name: "main",
                  kind: "value" as t.TypeKind,
                  generics: null,
                  isExported: true,
                  isDefault: true,
               },
            ],
         });
         const ig = generator();
         expect(ig.getDeclaration(pfs, "config.key")).toStrictEqual(
            'import type { settings as config } from "./schema";',
         );
         expect(ig.getDeclaration(pfs, "main")).toStrictEqual(
            'import type { default as main } from "./schema";',
         );
      });
   });

   describe("getValueImport", () => {
      const pfs = (fullPath = "/project/src/autoipc/schema.ts"): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: { channelSpecArray: [], importSpecArray: [], typeSpecArray: [] },
      });
      const ref = (overrides: Partial<t.ValidatorRef> = {}): t.ValidatorRef => ({
         name: "idArgs",
         exported: "idArgs",
         fromPath: "./validators",
         ...overrides,
      });

      it("imports a named export as a value, relative to the generated file", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         expect(ig.getValueImport(pfs(), ref())).toStrictEqual({
            local: "idArgs",
            declaration: 'import { idArgs } from "./validators";',
         });
      });

      it("resolves the path from the schema file to the generated file", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         const nested = pfs("/project/src/autoipc/schema/user/schema.ts");
         expect(ig.getValueImport(nested, ref({ fromPath: "../validators.ts" })).declaration).toBe(
            'import { idArgs } from "./schema/validators";',
         );
      });

      it("adds the extension of the compiled file for NodeNext", () => {
         const ig = new ImportsGenerator(true, "/project/src/autoipc/main.ts");
         expect(ig.getValueImport(pfs(), ref({ fromPath: "./validators.ts" })).declaration).toBe(
            'import { idArgs } from "./validators.js";',
         );
      });

      it("keeps a package specifier as written", () => {
         const ig = new ImportsGenerator(true, "/project/src/autoipc/main.ts");
         const imported = ig.getValueImport(pfs(), ref({ fromPath: "@scope/validators" }));
         expect(imported.declaration).toBe('import { idArgs } from "@scope/validators";');
      });

      it("imports a default export and an aliased export", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         expect(
            ig.getValueImport(pfs(), ref({ name: "noArgs", exported: "default" })).declaration,
         ).toBe('import noArgs from "./validators";');
         expect(ig.getValueImport(pfs(), ref({ name: "ids" })).declaration).toBe(
            'import { idArgs as ids } from "./validators";',
         );
      });

      it("returns the import line once, for the same export of the same module", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         const first = ig.getValueImport(pfs(), ref());
         const second = ig.getValueImport(pfs(), ref({ fromPath: "./validators.ts" }));
         expect(first.declaration).not.toBeNull();
         expect(second).toStrictEqual({ local: "idArgs", declaration: null });
      });

      it("imports two different exports under the same name under distinct names", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         const first = ig.getValueImport(pfs(), ref());
         const second = ig.getValueImport(pfs(), ref({ fromPath: "./other" }));
         expect(first.local).toBe("idArgs");
         expect(second).toStrictEqual({
            local: "idArgs_2",
            declaration: 'import { idArgs as idArgs_2 } from "./other";',
         });
      });

      it("does not take a reserved name, or the name of an imported type", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts", ["ipc"]);
         expect(ig.getValueImport(pfs(), ref({ name: "ipc", exported: "ipc" })).local).toBe(
            "ipc_2",
         );
         const file = pfs();
         file.specs.importSpecArray.push({
            fromPath: "./types",
            customTypes: ["idArgs"],
            namespace: null,
         });
         ig.getDeclaration(file, "idArgs");
         expect(ig.getValueImport(pfs(), ref()).local).toBe("idArgs_2");
      });

      it("does not mix a value import with a type import of the same export", () => {
         const ig = new ImportsGenerator(false, "/project/src/autoipc/main.ts");
         const file = pfs();
         file.specs.importSpecArray.push({
            fromPath: "./validators",
            customTypes: ["idArgs"],
            namespace: null,
         });
         const type = ig.getDeclaration(file, "idArgs");
         const value = ig.getValueImport(file, ref());
         expect(type).toBe('import type { idArgs } from "./validators";');
         expect(value.declaration).toBe('import { idArgs as idArgs_2 } from "./validators";');
      });
   });
});
