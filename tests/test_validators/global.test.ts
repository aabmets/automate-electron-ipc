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

import {
   validateGlobalChannelSpecs,
   validateReservedApiNames,
   validateTypeSpecs,
} from "@src/validation/global-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateGlobalChannelSpecs", () => {
   const file = (relativePath: string, specs: t.ChannelSpec[]): t.ParsedFileSpecs => ({
      fullPath: `/project/ipc/schema/${relativePath}`,
      relativePath,
      specs: {
         channelSpecArray: specs,
         channelMapExport: { kind: "default" },
         importSpecArray: [],
         typeSpecArray: [],
      },
   });
   const spec = (name: string): t.ChannelSpec => ({
      ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast"),
      name,
   });

   it("should accept unique channels across files", () => {
      const files = [file("a.ts", [spec("getUser")]), file("b.ts", [spec("getPost")])];
      expect(() => validateGlobalChannelSpecs(files)).not.toThrowError();
   });

   it("should throw an error naming both files when a channel is declared twice", () => {
      const files = [file("b.ts", [spec("getUser")]), file("a.ts", [spec("getUser")])];
      expect(() => validateGlobalChannelSpecs(files)).toThrowError(
         "Channel name 'getUser' is declared in both 'a.ts' and 'b.ts'",
      );
   });

   // Regression for T67: the files were compared with `localeCompare`, and `\\` was not
   // normalized like in ipcAutomation, so the file named first was not the first one processed.
   it("should name the files in code unit order of their normalized paths", () => {
      const files = [file("a.ts", [spec("getUser")]), file("B.ts", [spec("getUser")])];
      expect(() => validateGlobalChannelSpecs(files)).toThrowError(
         "Channel name 'getUser' is declared in both 'B.ts' and 'a.ts'",
      );
      const nested = [file("dir\\z.ts", [spec("getUser")]), file("dir-a/x.ts", [spec("getUser")])];
      expect(() => validateGlobalChannelSpecs(nested)).toThrowError(
         "Channel name 'getUser' is declared in both 'dir-a/x.ts' and 'dir\\z.ts'",
      );
   });
});

describe("validateReservedApiNames", () => {
   const file = (relativePath: string, names: string[]): t.ParsedFileSpecs => ({
      fullPath: `/project/ipc/${relativePath}`,
      relativePath,
      specs: {
         channelSpecArray: names.map((name) => ({
            ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast"),
            name,
         })),
         channelMapExport: { kind: "default" },
         importSpecArray: [],
         typeSpecArray: [],
      },
   });

   it("accepts a channel named getPathForFile while the config is off", () => {
      const files = [file("a.ts", ["getPathForFile"])];
      expect(() => validateReservedApiNames(files, {})).not.toThrowError();
      expect(() => validateReservedApiNames(files, { getPathForFile: false })).not.toThrowError();
   });

   it("accepts other channels while the config is on", () => {
      const files = [file("a.ts", ["getPath", "getPathForFiles"])];
      expect(() => validateReservedApiNames(files, { getPathForFile: true })).not.toThrowError();
   });

   it("rejects a channel named getPathForFile while the config is on, and names its file", () => {
      const files = [file("a.ts", ["ok"]), file("b.ts", ["getPathForFile"])];
      expect(() => validateReservedApiNames(files, { getPathForFile: true })).toThrowError(
         /Schema file 'b\.ts': Channel name 'getPathForFile' is reserved/,
      );
   });
});

describe("validateTypeSpecs", () => {
   it("should accept exported types", () => {
      validateTypeSpecs([
         {
            name: "VitestInterface",
            kind: "interface" as t.TypeKind,
            generics: null,
            isExported: true,
         },
      ]);
   });

   const hiddenSpec = {
      name: "VitestInterface",
      kind: "interface" as t.TypeKind,
      generics: null,
      isExported: false,
   };
   const channelUsing = (...customTypes: string[]) =>
      ({ name: "vitestChannel", signature: { customTypes } }) as unknown as t.ChannelSpec;

   // T09: a helper type in the schema file no longer has to be exported.
   it("should accept non-exported types that no channel uses", () => {
      expect(validateTypeSpecs([hiddenSpec])).toStrictEqual([hiddenSpec]);
      expect(validateTypeSpecs([hiddenSpec], [channelUsing("Other")])).toStrictEqual([hiddenSpec]);
   });

   it("should throw on a non-exported type that a channel uses", () => {
      expect(() => validateTypeSpecs([hiddenSpec], [channelUsing("VitestInterface")])).toThrowError(
         "Type 'VitestInterface' is used by channel 'vitestChannel' and must be exported",
      );
   });

   it("should throw on a non-exported type that a channel uses by a qualified name", () => {
      const spec = { ...hiddenSpec, kind: "enum" as t.TypeKind };
      expect(() =>
         validateTypeSpecs([spec], [channelUsing("VitestInterface.Member")]),
      ).toThrowError("Type 'VitestInterface' is used by channel 'vitestChannel'");
   });

   describe("aliases of import-equals", () => {
      const alias = (name: string, aliasOf: string, isExported = false) => ({
         name,
         kind: "alias" as t.TypeKind,
         generics: null,
         isExported,
         aliasOf,
      });

      it("should accept an alias that is not exported, since it is resolved to its target", () => {
         const spec = alias("User", "Models.User");
         expect(validateTypeSpecs([spec], [channelUsing("User")])).toStrictEqual([spec]);
      });

      it("should throw when the target of an alias, through a chain, is not exported", () => {
         const specs = [alias("Point", "Shapes.Point"), alias("Shapes", "Hidden"), hiddenSpec];
         const hidden = { ...hiddenSpec, name: "Hidden" };
         expect(() =>
            validateTypeSpecs([...specs.slice(0, 2), hidden], [channelUsing("Point")]),
         ).toThrowError("Type 'Hidden' is used by channel 'vitestChannel' and must be exported");
      });

      it("should accept aliases that refer to one another", () => {
         const specs = [alias("A", "B.X"), alias("B", "A.Y")];
         expect(validateTypeSpecs(specs, [channelUsing("A")])).toStrictEqual(specs);
      });
   });

   it("should accept a type that is exported under another name", () => {
      const spec = { ...hiddenSpec, isExported: true, exportedAs: "Public" };
      expect(validateTypeSpecs([spec], [channelUsing("VitestInterface")])).toStrictEqual([spec]);
   });

   it("should accept exported types that a channel uses", () => {
      const spec = { ...hiddenSpec, isExported: true, isDefault: true };
      expect(validateTypeSpecs([spec], [channelUsing("VitestInterface")])).toStrictEqual([spec]);
   });
});
