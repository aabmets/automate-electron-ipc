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
         csg.generate("MainToRenderer", "Port"),
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

   it("should throw Struct error when channel name is not a plain identifier", () => {
      for (const name of ["", "get-user", "get user", "1st", "a.b", "a'b"]) {
         const spec = { ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"), name };
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel name '${name}' is not a plain identifier`,
         );
      }
   });

   // T72: the 3 character, 'on' and lowercase rules came from the listener names, which are gone.
   it("should accept short, 'on'-prefixed and capitalized channel names", () => {
      const names = [
         "ok",
         "on",
         "a",
         "onReady",
         "onVitestChannel",
         "VitestChannel",
         "_x",
         "$x",
         "getÜser",
      ];
      for (const name of names) {
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

describe("validateOptionalConfig, rawErrors", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it("accepts a boolean, and no value at all", () => {
      for (const rawErrors of [true, false, undefined]) {
         expect(() => vld.validateOptionalConfig({ ...config, rawErrors })).not.toThrowError();
      }
   });

   it.each(["true", 1, null, {}])("rejects %j, since it is not a boolean", (rawErrors) => {
      const value = rawErrors as unknown as boolean;
      expect(() => vld.validateOptionalConfig({ ...config, rawErrors: value })).toThrowError(
         /rawErrors/,
      );
   });
});

describe("validateOptionalConfig, channelPrefix", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (channelPrefix: unknown) =>
      vld.validateOptionalConfig({ ...config, channelPrefix: channelPrefix as string });

   it.each(["", "autoipc:", "my-app/v1:", "app_2.", "@scope/app#", "A".repeat(64)])(
      "accepts '%s'",
      (prefix) => {
         expect(() => check(prefix)).not.toThrowError();
      },
   );

   it("accepts a config without a prefix", () => {
      expect(() => vld.validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([
      "it's",
      'say "hi"',
      "back\\slash",
      "two words",
      "line\nbreak",
      "tab\t",
      "${x}",
      "`",
      "é",
   ])("rejects %j, since it would break the generated string literal or the name", (prefix) => {
      expect(() => check(prefix)).toThrowError(/channelPrefix can contain only/);
   });

   it("rejects a prefix of more than 64 characters", () => {
      expect(() => check("a".repeat(65))).toThrowError(/longer than 64/);
   });

   it.each([5, null, true, ["a"]])("rejects %j, since it is not a string", (prefix) => {
      expect(() => check(prefix)).toThrowError(/channelPrefix/);
   });
});

describe("validateChannelSpecs, errors", () => {
   const errors = { definition: "NotFoundError | AuthError", customTypes: ["NotFoundError"] };
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      value: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, errors: value } as Partial<t.ChannelSpec>];
   };

   it("accepts the error types of a Unicast channel", () => {
      const specs = make("RendererToMain", "Unicast", errors);
      expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects error types on every other channel", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Broadcast"],
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         const specs = make(direction, kind, errors);
         expect(() => vld.validateChannelSpecs(specs)).toThrowError(/errors/);
      }
   });

   it("rejects error types which lack the text or the custom types", () => {
      for (const value of [{ definition: "X" }, { customTypes: [] }, "X", 5]) {
         const specs = make("RendererToMain", "Unicast", value);
         expect(() => vld.validateChannelSpecs(specs)).toThrowError(/errors/);
      }
   });
});

describe("validateTypeSpecs, error types", () => {
   it("requires a type that only the error types of a channel use to be exported", () => {
      const channel = {
         ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"),
         errors: { definition: "Hidden.Kind", customTypes: ["Hidden.Kind"] },
      } as t.ChannelSpec;
      const spec = { name: "Hidden", kind: "type", generics: null, isExported: false };

      expect(() => vld.validateTypeSpecs([spec], [channel])).toThrowError(
         /Type 'Hidden' is used by channel .* must be exported/,
      );
      expect(() => vld.validateTypeSpecs([{ ...spec, isExported: true }], [channel])).not.toThrow();
   });
});

describe("validateChannelSpecs, ask channels", () => {
   const generate = (returnType = "void") =>
      new ChannelSpecGenerator().generate("MainToRenderer", "Unicast", returnType);

   it("accepts a Unicast channel from the main process to a renderer, with any return type", () => {
      for (const returnType of ["void", "boolean", "Promise<Document>", "Promise<void>"]) {
         expect(() => vld.validateChannelSpecs([generate(returnType)])).not.toThrowError();
      }
   });

   it("still rejects a Unicast channel between two renderers", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToRenderer", "Unicast");
      expect(() => vld.validateChannelSpecs([spec])).toThrowError(
         "Channel kind 'Unicast' is not allowed when channel direction is 'RendererToRenderer'.",
      );
   });

   it("rejects the error types, the origins, the validator and the trigger of other verbs", () => {
      const ref = { name: "args", exported: "args", fromPath: "./v" };
      for (const extra of [
         { errors: { definition: "Error", customTypes: [] } },
         { allowedOrigins: ["app://."] },
         { validate: ref },
         { trigger: "focus" },
      ]) {
         const [key] = Object.keys(extra);
         expect(() => vld.validateChannelSpecs([{ ...generate(), ...extra }])).toThrowError(
            new RegExp(key),
         );
      }
   });

   it("keeps the names of the asks unique among all channels", () => {
      const spec = generate();
      const clash = { ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast") };
      expect(() => vld.validateChannelSpecs([spec, { ...clash, name: spec.name }])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
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

describe("validateChannelSpecs, structured clone", () => {
   const issue = (patch: Partial<t.CloneIssue> = {}): t.CloneIssue => ({
      level: "error",
      where: "parameter 'cb'",
      type: "() => void",
      reason: "a function",
      ...patch,
   });
   const specWith = (...cloneIssues: t.CloneIssue[]): t.ChannelSpec => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      return { ...spec, name: "runTask", signature: { ...spec.signature, cloneIssues } };
   };

   it("throws for an error issue and names the channel, the place and the type", () => {
      expect(() => vld.validateChannelSpecs([specWith(issue())])).toThrowError(
         "Channel 'runTask': parameter 'cb' contains a function ('() => void'). " +
            "It cannot be sent over IPC, and Electron throws 'An object could not be cloned'.",
      );
   });

   it("names the schema file and the local types that lead to the issue", () => {
      const spec = specWith(issue({ type: "symbol", reason: "a symbol", via: "Options → Key" }));
      expect(() => vld.validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         "Schema file 'ipc/schema.ts': Channel 'runTask': parameter 'cb' contains a symbol " +
            "('symbol') through 'Options → Key'.",
      );
   });

   it("explains that only the result of invoke is a Promise", () => {
      const spec = specWith(issue({ type: "Promise<string>", reason: "a Promise" }));
      expect(() => vld.validateChannelSpecs([spec])).toThrowError(
         "Only the result of an 'invoke' channel is a Promise, so send the resolved value.",
      );
   });

   it("reports every error issue, one per line", () => {
      const spec = specWith(
         issue(),
         issue({ where: "return type", type: "WeakMap<object, number>", reason: "a WeakMap" }),
      );
      let message = "";
      try {
         vld.validateChannelSpecs([spec]);
      } catch (err) {
         message = (err as Error).message;
      }
      const lines = message.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("parameter 'cb' contains a function");
      expect(lines[1]).toContain("return type contains a WeakMap ('WeakMap<object, number>')");
   });

   it.each(["Broadcast", "Unicast", "Port"] as const)("checks %s channels", (kind) => {
      const direction = kind === "Port" ? "RendererToRenderer" : "RendererToMain";
      const generated = new ChannelSpecGenerator().generate(direction, kind);
      const spec = { ...generated, signature: { ...generated.signature, cloneIssues: [issue()] } };
      expect(() => vld.validateChannelSpecs([spec])).toThrowError(/contains a function/);
   });

   it("does not throw for a warning, and returns the spec", () => {
      const spec = specWith(
         issue({ level: "warning", type: "User", reason: "an instance of the class 'User'" }),
      );
      expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
   });

   it("accepts a signature without issues", () => {
      expect(() => vld.validateChannelSpecs([specWith()])).not.toThrowError();
   });

   it("rejects an issue with an unknown level", () => {
      const spec = specWith(issue({ level: "fatal" as never }));
      expect(() => vld.validateChannelSpecs([spec])).toThrowError(/level must be/);
   });
});

describe("getCloneWarnings", () => {
   const warning: t.CloneIssue = {
      level: "warning",
      where: "parameter 'user'",
      type: "User",
      reason: "an instance of the class 'User'",
   };
   const specWith = (name: string, ...cloneIssues: t.CloneIssue[]): t.ChannelSpec => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      return { ...spec, name, signature: { ...spec.signature, cloneIssues } };
   };

   it("describes each warning with the file, the channel and the advice", () => {
      const warnings = vld.getCloneWarnings([specWith("saveUser", warning)], "ipc/schema.ts");
      expect(warnings).toStrictEqual([
         "Schema file 'ipc/schema.ts': Channel 'saveUser': parameter 'user' contains an instance " +
            "of the class 'User' ('User'). An instance loses its prototype and methods over IPC " +
            "and arrives as a plain object. Use an interface or a type alias for the data.",
      ]);
   });

   it("leaves out the file when it is unknown, and the errors and clean channels", () => {
      const specs = [
         specWith("a", warning),
         specWith("b"),
         specWith("c", { ...warning, level: "error" }),
      ];
      const warnings = vld.getCloneWarnings(specs);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].startsWith("Channel 'a': parameter 'user'")).toBe(true);
   });

   it("names the local types that lead to the class", () => {
      const warnings = vld.getCloneWarnings([specWith("a", { ...warning, via: "Row" })]);
      expect(warnings[0]).toContain("('User') through 'Row'.");
   });
});
