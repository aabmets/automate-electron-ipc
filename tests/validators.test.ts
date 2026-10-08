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
      const config: t.IPCOptionalConfig = {
         projectUsesNodeNext: false,
         ipcDataDir: "/absolute/path/auto-ipc",
         codeIndent: 3,
      };
      expect(() => vld.validateOptionalConfig(config)).toThrowError(
         "ipcDataDir must be relative to the project root",
      );
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
      const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc" };
      for (const codeIndent of [1, 5]) {
         expect(() => vld.validateOptionalConfig({ ...config, codeIndent })).toThrowError(
            "value cannot be less than 2 or greater than 4",
         );
      }
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
         expect(vld.validateChannelSpecs([{ ...spec, name }])).toStrictEqual([{ ...spec, name }]);
      }
   });

   it("should reject channel names that are members of every object", () => {
      const names = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];
      for (const name of [...names, "__proto__", "toLocaleString", "propertyIsEnumerable"]) {
         const spec = { ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"), name };
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel name '${name}' is reserved`,
         );
      }
   });

   it("should name the file and the channel when a channel name is reserved", () => {
      const spec = {
         ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"),
         name: "constructor",
      };
      expect(() => vld.validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         "Schema file 'ipc/schema.ts': Channel name 'constructor' is reserved",
      );
   });

   it("should accept channel names that merely contain or extend a reserved name", () => {
      for (const name of ["constructors", "toStringify", "valueOfIt", "hasOwn"]) {
         const spec = { ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"), name };
         expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
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

   // Regression for T69: the check compared the text, so `Promise<void >` was rejected.
   it("should accept the void return types that the parser reports, whatever the spacing", () => {
      const csg = new ChannelSpecGenerator();
      for (const kind of ["Broadcast", "Port"] as const) {
         const direction = kind === "Port" ? "RendererToRenderer" : "RendererToMain";
         const spec = csg.generate(direction, kind, "Promise<void >");
         spec.signature.returnsVoid = true;
         expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
      }
   });

   it("should trust returnsVoid over the text of the return type", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Broadcast", "Foo");
      spec.signature.returnsVoid = false;
      expect(() => vld.validateChannelSpecs([spec])).toThrowError(
         "Channel return type 'Foo' not allowed when channel kind is 'Broadcast'",
      );
   });

   it("should ignore whitespace when a spec has no returnsVoid", () => {
      const spec = new ChannelSpecGenerator().generate(
         "RendererToMain",
         "Broadcast",
         "Promise<void >",
      );
      expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
   });
});

describe("validateChannelSpecs, allowedOrigins", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      allowedOrigins: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, allowedOrigins } as Partial<t.ChannelSpec>];
   };

   it("accepts origins of Unicast and Broadcast channels from a renderer", () => {
      for (const kind of ["Unicast", "Broadcast"] as const) {
         const specs = make("RendererToMain", kind, [
            "app://.",
            "http://localhost:5173",
            "https://example.com",
            "file://",
            "https://[::1]:8080",
         ]);
         expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
      }
   });

   it("accepts a channel without allowedOrigins", () => {
      const specs = [new ChannelSpecGenerator().generate("RendererToMain", "Unicast")];
      expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects allowedOrigins on MainToRenderer and Port channels", () => {
      for (const [direction, kind] of [
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         const specs = make(direction, kind, ["app://."]);
         expect(() => vld.validateChannelSpecs(specs)).toThrowError(/allowedOrigins/);
      }
   });

   it("rejects an empty list, since it would allow no caller", () => {
      const specs = make("RendererToMain", "Unicast", []);
      expect(() => vld.validateChannelSpecs(specs)).toThrowError(/at least one origin/);
   });

   it.each([
      "*",
      "app://.*",
      "*.example.com",
      "https://*.example.com",
      "example.com",
      "localhost:5173",
      "http://localhost:5173/",
      "http://localhost:5173/index.html",
      "http://localhost:5173?x=1",
      "http://localhost:5173#x",
      "http://user:pass@example.com",
      "HTTP://example.com",
      "http://EXAMPLE.com",
      "http://exa mple.com",
      " app://.",
      "null",
      "",
      "://host",
   ])("rejects '%s' as it is not an origin", (origin) => {
      const specs = make("RendererToMain", "Broadcast", ["app://.", origin]);
      expect(() => vld.validateChannelSpecs(specs)).toThrowError(/is not an origin/);
   });

   it("rejects a value which is not an array of strings", () => {
      for (const value of ["app://.", [1], { a: 1 }]) {
         const specs = make("RendererToMain", "Unicast", value);
         expect(() => vld.validateChannelSpecs(specs)).toThrowError();
      }
   });
});

describe("validateChannelSpecs, validate", () => {
   const ref = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      validate: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, validate } as Partial<t.ChannelSpec>];
   };

   it("accepts a validator on Unicast and Broadcast channels from a renderer", () => {
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() =>
            vld.validateChannelSpecs(make("RendererToMain", kind, ref)),
         ).not.toThrowError();
      }
   });

   it("accepts the default export of a package", () => {
      const specs = make("RendererToMain", "Unicast", {
         name: "schema",
         exported: "default",
         fromPath: "@scope/validators",
      });
      expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects validate on MainToRenderer and Port channels", () => {
      for (const [direction, kind] of [
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         expect(() => vld.validateChannelSpecs(make(direction, kind, ref))).toThrowError(
            /validate/,
         );
      }
   });

   it.each([
      { ...ref, name: "not valid" },
      { ...ref, name: "" },
      { ...ref, exported: "a-b" },
      { ...ref, fromPath: "" },
      { name: "x" },
      "idArgs",
      null,
   ])("rejects the malformed reference %j", (value) => {
      expect(() =>
         vld.validateChannelSpecs(make("RendererToMain", "Unicast", value)),
      ).toThrowError();
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
   const spec = (name: string): t.ChannelSpec => ({
      ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast"),
      name,
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
