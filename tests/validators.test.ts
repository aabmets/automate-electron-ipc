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

import vld from "@src/validators.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateOptionalConfig", () => {
   it("should throw an error if ipcDataDir path is absolute", () => {
      const config: t.IPCOptionalConfig = { ipcDataDir: "/absolute/path/auto-ipc" };
      expect(() => vld.validateOptionalConfig(config)).toThrowError();
   });

   it("should throw an error if codeIndent is not an integer", () => {
      // Regression for T58: 2.5 was accepted and silently rounded down by `repeat`.
      const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc" };
      expect(() => vld.validateOptionalConfig({ ...config, codeIndent: 2.5 })).toThrowError(
         /integer/,
      );
      expect(() => vld.validateOptionalConfig({ ...config, codeIndent: 3.999 })).toThrowError(
         /integer/,
      );
      expect(() => vld.validateOptionalConfig({ ...config, codeIndent: 1 })).toThrowError(
         /cannot be less than 2 or greater than 4/,
      );
      for (const codeIndent of [2, 3, 4]) {
         expect(() => vld.validateOptionalConfig({ ...config, codeIndent })).not.toThrowError();
      }
   });

   it("should throw errors if codeIndent value is out of range", () => {
      expect(() => vld.validateOptionalConfig({ codeIndent: 1 })).toThrowError();
      expect(() => vld.validateOptionalConfig({ codeIndent: 5 })).toThrowError();
   });
});

describe("validateChannelSpecs", () => {
   it("should not throw Struct errors on valid channel specs", () => {
      const csg = new ChannelSpecGenerator();
      const channelSpecsArray: Partial<t.ChannelSpec>[] = [
         csg.generate("RendererToMain", "Broadcast"),
         csg.generate("MainToRenderer", "Broadcast"),
         csg.generate("RendererToMain", "Unicast"),
         csg.generate("RendererToRenderer", "Port"),
      ];
      try {
         const retVal = vld.validateChannelSpecs(channelSpecsArray);
         expect(retVal).toMatchObject(channelSpecsArray);
      } catch {
         throw new Error(
            "validateChannelSpecs should not throw Struct errors on valid channel specs",
         );
      }
   });

   it("should throw Struct error when channel name is invalid", () => {
      const collection = [
         {
            spec: { name: "xy", kind: "Broadcast" },
            err: "Channel name must be at least 3 characters in length",
         },
         {
            spec: { name: "onVitestChannel", kind: "Broadcast" },
            err: "Channel name must not begin with 'on'",
         },
         {
            spec: { name: "VitestChannel", kind: "Broadcast" },
            err: "Channel name must start with a lowercase letter",
         },
      ];
      for (const { spec, err } of collection) {
         expect(() => vld.validateChannelSpecs([spec as t.ChannelSpec])).toThrowError(err);
      }
   });

   it("should accept camelCase channel names, including ones that start with 'on'", () => {
      for (const name of ["getUser", "echo_name", "online", "once"]) {
         const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
         expect(() => vld.validateChannelSpecs([{ ...spec, name }])).not.toThrowError();
      }
   });

   it("should detect a custom listener that clashes with the capitalized channel listener", () => {
      const csg = new ChannelSpecGenerator();
      const specs = [
         { ...csg.generate("RendererToMain", "Broadcast"), name: "getUser" },
         csg.generate("RendererToMain", "Broadcast", "void", ["onGetUser"]),
      ];
      expect(() => vld.validateChannelSpecs(specs)).toThrowError("'onGetUser'");
   });

   it("should throw Struct error when a listener name is malformed", () => {
      const csg = new ChannelSpecGenerator();
      const collection = [
         { listener: "onA", err: "Channel listener names must be at least 5 characters in length" },
         { listener: "handleThing", err: "Channel listener names must begin with lowercase 'on'" },
      ];
      for (const { listener, err } of collection) {
         const spec = csg.generate("RendererToMain", "Broadcast", "void", [listener]);
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(err);
      }
   });

   it("should throw Struct error when channel kind is not a known kind", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      const invalid = { ...spec, kind: "Stream" } as unknown as t.ChannelSpec;
      expect(() => vld.validateChannelSpecs([invalid])).toThrowError(
         "Channel kind must be one of: ['Broadcast', 'Unicast', 'Port']",
      );
   });

   it("should throw Struct error when channel kind does not match direction", () => {
      const csg = new ChannelSpecGenerator();
      const invalidChannelSpecsArray = [
         csg.generate("RendererToRenderer", "Broadcast"),
         csg.generate("RendererToRenderer", "Unicast"),
         csg.generate("MainToRenderer", "Unicast"),
         csg.generate("MainToRenderer", "Port"),
         csg.generate("RendererToMain", "Port"),
      ];
      for (const spec of invalidChannelSpecsArray) {
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel kind '${spec.kind}' is not allowed when channel direction is '${spec.direction}'.`,
         );
      }
   });

   it("should throw Struct error when return type is invalid for channel kind", () => {
      const csg = new ChannelSpecGenerator();
      const invalidChannelSpecsArray = [
         csg.generate("RendererToMain", "Broadcast", "string"),
         csg.generate("RendererToMain", "Broadcast", "Promise<string>"),
         csg.generate("RendererToRenderer", "Port", "string"),
         csg.generate("RendererToRenderer", "Port", "Promise<string>"),
      ];
      for (const spec of invalidChannelSpecsArray) {
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel return type '${spec.signature.returnType}' not allowed when channel kind is '${spec.kind}'`,
         );
      }
   });

   it("should throw Struct error for Unicast or Port kind channels", () => {
      const csg = new ChannelSpecGenerator();
      const invalidChannelSpecsArray = [
         csg.generate("RendererToMain", "Unicast", "string", ["onChannel"]),
         csg.generate("RendererToRenderer", "Port", "void", ["onChannel"]),
      ];
      for (const spec of invalidChannelSpecsArray) {
         expect(() => vld.validateChannelSpecs([spec])).toThrowError();
      }
   });

   it("should allow listeners array for Broadcast kind channels", () => {
      const csg = new ChannelSpecGenerator();
      const invalidChannelSpecsArray = [
         csg.generate("RendererToMain", "Broadcast", "void", ["onChannel"]),
         csg.generate("MainToRenderer", "Broadcast", "void", ["onChannel"]),
      ];
      for (const spec of invalidChannelSpecsArray) {
         const retVal = vld.validateChannelSpecs([spec]);
         expect(retVal).toMatchObject([spec]);
      }
   });
});

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
   const spec = (name: string, listeners?: string[]): t.ChannelSpec => ({
      ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast"),
      name,
      ...(listeners ? { listeners } : {}),
   });

   it("should accept unique channels across files", () => {
      const files = [file("a.ts", [spec("getUser")]), file("b.ts", [spec("getPost")])];
      expect(() => vld.validateGlobalChannelSpecs(files)).not.toThrowError();
   });

   it("should throw an error naming both files when a channel is declared twice", () => {
      const files = [file("b.ts", [spec("getUser")]), file("a.ts", [spec("getUser")])];
      expect(() => vld.validateGlobalChannelSpecs(files)).toThrowError(
         "Channel name 'getUser' is declared in both 'a.ts' and 'b.ts'",
      );
   });

   // Regression for T67: the files were compared with `localeCompare`, and `\\` was not
   // normalized like in ipcAutomation, so the file named first was not the first one processed.
   it("should name the files in code unit order of their normalized paths", () => {
      const files = [file("a.ts", [spec("getUser")]), file("B.ts", [spec("getUser")])];
      expect(() => vld.validateGlobalChannelSpecs(files)).toThrowError(
         "Channel name 'getUser' is declared in both 'B.ts' and 'a.ts'",
      );
      const nested = [file("dir\\z.ts", [spec("getUser")]), file("dir-a/x.ts", [spec("getUser")])];
      expect(() => vld.validateGlobalChannelSpecs(nested)).toThrowError(
         "Channel name 'getUser' is declared in both 'dir-a/x.ts' and 'dir\\z.ts'",
      );
   });

   it("should throw an error naming both files when listener names clash", () => {
      const files = [
         file("a.ts", [spec("getUser")]),
         file("b.ts", [spec("getPost", ["onGetUser"])]),
      ];
      expect(() => vld.validateGlobalChannelSpecs(files)).toThrowError(
         /'onGetUser' of channel 'getPost' in 'b\.ts' clashes .* 'getUser' in 'a\.ts'/,
      );
   });
});

describe("validateTypeSpecs", () => {
   it("should accept exported types", () => {
      vld.validateTypeSpecs([
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
      expect(vld.validateTypeSpecs([hiddenSpec])).toStrictEqual([hiddenSpec]);
      expect(vld.validateTypeSpecs([hiddenSpec], [channelUsing("Other")])).toStrictEqual([
         hiddenSpec,
      ]);
   });

   it("should throw on a non-exported type that a channel uses", () => {
      expect(() =>
         vld.validateTypeSpecs([hiddenSpec], [channelUsing("VitestInterface")]),
      ).toThrowError(
         "Type 'VitestInterface' is used by channel 'vitestChannel' and must be exported",
      );
   });

   it("should throw on a non-exported type that a channel uses by a qualified name", () => {
      const spec = { ...hiddenSpec, kind: "enum" as t.TypeKind };
      expect(() =>
         vld.validateTypeSpecs([spec], [channelUsing("VitestInterface.Member")]),
      ).toThrowError("Type 'VitestInterface' is used by channel 'vitestChannel'");
   });

   it("should accept a type that is exported under another name", () => {
      const spec = { ...hiddenSpec, isExported: true, exportedAs: "Public" };
      expect(vld.validateTypeSpecs([spec], [channelUsing("VitestInterface")])).toStrictEqual([
         spec,
      ]);
   });

   it("should accept exported types that a channel uses", () => {
      const spec = { ...hiddenSpec, isExported: true, isDefault: true };
      expect(vld.validateTypeSpecs([spec], [channelUsing("VitestInterface")])).toStrictEqual([
         spec,
      ]);
   });
});
