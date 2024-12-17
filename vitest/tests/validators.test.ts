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
            spec: { name: "vitestChannel", kind: "Broadcast" },
            err: "Channel name must start with a capital letter",
         },
      ];
      for (const { spec, err } of collection) {
         expect(() => vld.validateChannelSpecs([spec as t.ChannelSpec])).toThrowError(err);
      }
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

   it("should throw struct error on non-exported types", () => {
      const specs = [
         {
            name: "VitestInterface",
            kind: "interface" as t.TypeKind,
            generics: null,
            isExported: false,
         },
      ];
      expect(() => vld.validateTypeSpecs(specs)).toThrowError(
         "User-defined types must be exported",
      );
   });
});
