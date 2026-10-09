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
      const invalid = { ...spec, kind: "Pipe" } as unknown as t.ChannelSpec;
      expect(() => vld.validateChannelSpecs([invalid])).toThrowError(
         "Channel kind must be one of: ['Broadcast', 'Unicast', 'Port', 'Stream']",
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

describe("validateOptionalConfig, timeoutMs", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each([0, 1, 30_000, Number.MAX_SAFE_INTEGER, undefined])("accepts %s", (timeoutMs) => {
      expect(() => vld.validateOptionalConfig({ ...config, timeoutMs })).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null])(
      "rejects %j, since it is not a non-negative integer",
      (timeoutMs) => {
         const value = timeoutMs as unknown as number;
         expect(() => vld.validateOptionalConfig({ ...config, timeoutMs: value })).toThrowError(
            /timeoutMs/,
         );
      },
   );
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

describe("validateOptionalConfig, exposeAs", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (exposeAs: unknown) =>
      vld.validateOptionalConfig({ ...config, exposeAs: exposeAs as string });

   it.each(["ipc", "api", "myApp", "_bridge", "$ipc", "ipc2", "IpcApi", "electronApi"])(
      "accepts '%s'",
      (name) => {
         expect(() => check(name)).not.toThrowError();
      },
   );

   it.each(["", "my-app", "2ipc", "two words", "a.b", "it's", "ipc;", "é", "ipc\n"])(
      "rejects %j, since it is not an identifier",
      (name) => {
         expect(() => check(name)).toThrowError(/exposeAs must be an identifier/);
      },
   );

   it.each(["name", "status", "close", "open", "top", "length", "document", "fetch", "location"])(
      "rejects the property '%s' of window",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each(["class", "default", "new", "null", "true", "typeof", "eval", "arguments"])(
      "rejects the reserved word '%s'",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each(["Promise", "Error", "Symbol", "Object", "globalThis", "process", "require"])(
      "rejects the global '%s'",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each([5, null, true, ["a"]])("rejects %j, since it is not a string", (name) => {
      expect(() => check(name)).toThrowError(/exposeAs/);
   });
});

describe("validateOptionalConfig, isolatedWorldId", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (isolatedWorldId: unknown) =>
      vld.validateOptionalConfig({ ...config, isolatedWorldId: isolatedWorldId as number });

   it.each([1000, 1001, 5000, 2 ** 31 - 1])("accepts %d", (id) => {
      expect(() => check(id)).not.toThrowError();
   });

   it("accepts a config without a world", () => {
      expect(() => vld.validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([0, 1, 999, -1000, 1000.5, 2 ** 31, Number.POSITIVE_INFINITY])("rejects %d", (id) => {
      expect(() => check(id)).toThrowError(/isolatedWorldId must be an integer of 1000 or more/);
   });

   it.each(["1000", null, true, [1000], Number.NaN])(
      "rejects %j, since it is not a number",
      (id) => {
         expect(() => check(id)).toThrowError(/isolatedWorldId/);
      },
   );
});

describe("validateOptionalConfig, getPathForFile", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (getPathForFile: unknown) =>
      vld.validateOptionalConfig({ ...config, getPathForFile: getPathForFile as boolean });

   it.each([true, false])("accepts %s", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it.each(["true", 1, null, []])("rejects %j, since it is not a boolean", (value) => {
      expect(() => check(value)).toThrowError(/getPathForFile/);
   });
});

describe("validateOptionalConfig, serializer", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (serializer: unknown) =>
      vld.validateOptionalConfig({ ...config, serializer: serializer as string });

   it.each([
      "superjson",
      "@scope/wire",
      "pkg/sub/path",
      "msgpack-lite",
      "./wire.ts",
      "../shared/wire",
      "./src/lib/wire.codec.ts",
   ])("accepts '%s'", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it("accepts a config without a serializer", () => {
      expect(() => vld.validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([
      "",
      "/abs/wire.ts",
      ".wire",
      "..",
      "./",
      'wire"; import "evil',
      "has space",
      "back\\slash",
      "node:fs",
      "line\nbreak",
   ])("rejects %j", (value) => {
      expect(() => check(value)).toThrowError(/serializer/);
   });

   it.each([5, true, null, []])("rejects %j, since it is not a string", (value) => {
      expect(() => check(value)).toThrowError(/serializer/);
   });
});

describe("validateOptionalConfig, autoExpose", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (autoExpose: unknown) =>
      vld.validateOptionalConfig({ ...config, autoExpose: autoExpose as boolean });

   it.each([true, false])("accepts %s", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it.each(["false", 0, 1, null, []])("rejects %j, since it is not a boolean", (value) => {
      expect(() => check(value)).toThrowError(/autoExpose/);
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

describe("validateChannelSpecs, stream channels", () => {
   const generate = (returnType = "AsyncIterable<number>") =>
      new ChannelSpecGenerator().generate("RendererToMain", "Stream", returnType);

   it("accepts a Stream channel from a renderer to the main process", () => {
      for (const returnType of [
         "AsyncIterable<number>",
         "AsyncIterableIterator<Row>",
         "AsyncGenerator<string, void, undefined>",
      ]) {
         const spec = generate(returnType);
         expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
      }
   });

   it("accepts the origins, the validator and the error types of the call", () => {
      const ref = { name: "args", exported: "args", fromPath: "./v" };
      const spec = {
         ...generate(),
         allowedOrigins: ["app://."],
         validate: ref,
         errors: { definition: "NotFoundError", customTypes: ["NotFoundError"] },
      };
      expect(vld.validateChannelSpecs([spec])).toStrictEqual([spec]);
   });

   it("rejects every other direction", () => {
      for (const direction of ["MainToRenderer", "RendererToRenderer"] as const) {
         const spec = new ChannelSpecGenerator().generate(
            direction,
            "Stream",
            "AsyncIterable<number>",
         );
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel kind 'Stream' is not allowed when channel direction is '${direction}'.`,
         );
      }
   });

   it("needs the chunk type that the parser reads from the return type", () => {
      const spec = generate();
      const { chunkType: _chunkType, chunkStart: _chunkStart, ...signature } = spec.signature;
      expect(() => vld.validateChannelSpecs([{ ...spec, signature }])).toThrowError(
         /signature\.chunkType/,
      );
   });

   it("allows the chunk type only on a Stream channel", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      const signature = { ...spec.signature, chunkType: "number" };
      expect(() => vld.validateChannelSpecs([{ ...spec, signature }])).toThrowError(
         /signature\.chunkType/,
      );
   });

   it("rejects the trigger and the queue size of other verbs", () => {
      for (const extra of [{ trigger: "focus" }, { maxQueue: 5 }]) {
         const [key] = Object.keys(extra);
         expect(() => vld.validateChannelSpecs([{ ...generate(), ...extra }])).toThrowError(
            new RegExp(key),
         );
      }
   });

   it("does not require a void return type, and keeps the names unique among all channels", () => {
      const spec = generate("AsyncIterable<string>");
      const clash = { ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast") };
      expect(() => vld.validateChannelSpecs([spec])).not.toThrowError();
      expect(() => vld.validateChannelSpecs([spec, { ...clash, name: spec.name }])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });

   it("reports a chunk which cannot be cloned like any other part of a signature", () => {
      const spec = generate("AsyncIterable<() => void>");
      expect(() => vld.validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         /Schema file 'ipc\/schema.ts': Channel 'vitestChannel_0': chunk type contains a function/,
      );
   });
});

describe("validateChannelSpecs, scopes", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      scopes: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const returnType = kind === "Stream" ? "AsyncIterable<number>" : "void";
      const spec = new ChannelSpecGenerator().generate(direction, kind, returnType);
      return [{ ...spec, scopes } as Partial<t.ChannelSpec>];
   };

   it.each([
      ["RendererToMain", "Unicast"],
      ["RendererToMain", "Broadcast"],
      ["RendererToMain", "Stream"],
      ["MainToRenderer", "Broadcast"],
      ["MainToRenderer", "Unicast"],
      ["MainToRenderer", "Port"],
      ["RendererToRenderer", "Port"],
      ["RendererToUtility", "Unicast"],
      ["RendererToUtility", "Stream"],
   ] as const)("accepts scopes on a %s %s channel", (direction, kind) => {
      expect(() =>
         vld.validateChannelSpecs(make(direction, kind, ["settings", "plugin-host"])),
      ).not.toThrowError();
   });

   it.each([
      ["MainToUtility", "Unicast"],
      ["MainToUtility", "Broadcast"],
      ["UtilityToMain", "Unicast"],
      ["UtilityToMain", "Broadcast"],
   ] as const)(
      "rejects scopes on a %s %s channel, which no page has a part in",
      (direction, kind) => {
         expect(() => vld.validateChannelSpecs(make(direction, kind, ["settings"]))).toThrowError(
            /scopes/,
         );
      },
   );

   it("accepts a channel without scopes", () => {
      const specs = [new ChannelSpecGenerator().generate("RendererToMain", "Unicast")];
      expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
   });

   it.each(["settings", "a", "editor2", "plugin-host", "a-b-c", "x".repeat(32)])(
      "accepts '%s' as the name of a scope",
      (name) => {
         expect(() =>
            vld.validateChannelSpecs(make("RendererToMain", "Unicast", [name])),
         ).not.toThrowError();
      },
   );

   it("rejects an empty list, since it would put the channel in no window", () => {
      expect(() => vld.validateChannelSpecs(make("RendererToMain", "Unicast", []))).toThrowError(
         /at least one scope/,
      );
   });

   it("rejects 'default', which is the scope of the channels without scopes", () => {
      expect(() =>
         vld.validateChannelSpecs(make("RendererToMain", "Unicast", ["settings", "default"])),
      ).toThrowError(/'default' is the scope of the channels without scopes/);
   });

   it.each([
      "Settings",
      "my_scope",
      "2fast",
      "-a",
      "a-",
      "a--b",
      "a b",
      "a.b",
      "a/b",
      "..",
      "",
      "é",
      "x".repeat(33),
   ])("rejects '%s' as the name of a scope", (name) => {
      expect(() =>
         vld.validateChannelSpecs(make("RendererToMain", "Unicast", [name])),
      ).toThrowError(/is not a scope name/);
   });

   it("rejects a scope that is listed twice", () => {
      expect(() =>
         vld.validateChannelSpecs(make("RendererToMain", "Unicast", ["a", "b", "a"])),
      ).toThrowError(/scope 'a' is listed twice/);
   });

   it("rejects a value which is not an array of strings", () => {
      for (const value of ["settings", [1], { a: 1 }]) {
         expect(() =>
            vld.validateChannelSpecs(make("RendererToMain", "Unicast", value)),
         ).toThrowError();
      }
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

   it.each([
      "http://localhost:80",
      "https://example.com:443",
      "ws://localhost:80",
      "wss://localhost:443",
      "ftp://example.com:21",
      "http://localhost:080",
   ])(
      "rejects '%s', which has the default port of its scheme and so matches no origin",
      (origin) => {
         const specs = make("RendererToMain", "Unicast", ["app://.", origin]);
         expect(() => vld.validateChannelSpecs(specs)).toThrowError(
            /has the default port of its scheme.*Write '[^']+'/,
         );
      },
   );

   it("names the origin without the port in the message", () => {
      const specs = make("RendererToMain", "Unicast", ["https://example.com:443"]);
      expect(() => vld.validateChannelSpecs(specs)).toThrowError("Write 'https://example.com'");
   });

   it.each([
      "http://localhost:443",
      "https://example.com:80",
      "http://localhost:8080",
      "http://localhost:5173",
      "app://.:80",
   ])("keeps the origin '%s', whose port is not the default one of its scheme", (origin) => {
      const specs = make("RendererToMain", "Unicast", [origin]);
      expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects a default port in the origins of the channels that a worker calls", () => {
      const spec = new ChannelSpecGenerator().generate("ServiceWorkerToMain", "Unicast");
      expect(() =>
         vld.validateChannelSpecs([{ ...spec, allowedOrigins: ["https://example.com:443"] }]),
      ).toThrowError(/default port/);
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
      expect(() => vld.validateReservedApiNames(files, {})).not.toThrowError();
      expect(() =>
         vld.validateReservedApiNames(files, { getPathForFile: false }),
      ).not.toThrowError();
   });

   it("accepts other channels while the config is on", () => {
      const files = [file("a.ts", ["getPath", "getPathForFiles"])];
      expect(() =>
         vld.validateReservedApiNames(files, { getPathForFile: true }),
      ).not.toThrowError();
   });

   it("rejects a channel named getPathForFile while the config is on, and names its file", () => {
      const files = [file("a.ts", ["ok"]), file("b.ts", ["getPathForFile"])];
      expect(() => vld.validateReservedApiNames(files, { getPathForFile: true })).toThrowError(
         /Schema file 'b\.ts': Channel name 'getPathForFile' is reserved/,
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

describe("validateChannelSpecs, highWaterMark", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      highWaterMark: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(
         direction,
         kind,
         kind === "Stream" ? "AsyncIterable<number>" : undefined,
      );
      return [{ ...spec, highWaterMark } as Partial<t.ChannelSpec>];
   };

   it.each([
      ["RendererToMain", 0],
      ["RendererToMain", 1024],
      ["RendererToMain", Number.POSITIVE_INFINITY],
      ["RendererToMain", Number.MAX_SAFE_INTEGER],
      ["RendererToMain", undefined],
      ["RendererToUtility", 4],
      ["RendererToUtility", Number.POSITIVE_INFINITY],
   ] as const)("accepts %s %s on Stream channels", (direction, highWaterMark) => {
      expect(() =>
         vld.validateChannelSpecs(make(direction, "Stream", highWaterMark)),
      ).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (highWaterMark) => {
         const specs = make("RendererToMain", "Stream", highWaterMark);
         expect(() => vld.validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': highWaterMark must be a non-negative integer or Infinity/,
         );
      },
   );

   it("rejects a number that is not a number", () => {
      expect(() =>
         vld.validateChannelSpecs(make("RendererToMain", "Stream", Number.NaN)),
      ).toThrowError(/highWaterMark/);
      expect(() => vld.validateChannelSpecs(make("RendererToMain", "Stream", "10"))).toThrowError(
         /highWaterMark/,
      );
   });

   it("rejects highWaterMark on the channels that are not streams", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Unicast"],
         ["RendererToMain", "Broadcast"],
         ["MainToRenderer", "Broadcast"],
         ["MainToRenderer", "Unicast"],
         ["RendererToRenderer", "Port"],
         ["RendererToUtility", "Unicast"],
      ] as const) {
         expect(() => vld.validateChannelSpecs(make(direction, kind, 5))).toThrowError(
            /highWaterMark/,
         );
      }
   });
});

describe("validateChannelSpecs, maxQueue", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      maxQueue: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, maxQueue } as Partial<t.ChannelSpec>];
   };

   it.each([
      ["RendererToRenderer", 0],
      ["RendererToRenderer", 1],
      ["RendererToRenderer", 1000],
      ["MainToRenderer", 0],
      ["MainToRenderer", Number.POSITIVE_INFINITY],
      ["MainToRenderer", Number.MAX_SAFE_INTEGER],
      ["MainToRenderer", undefined],
   ] as const)("accepts %s %s on Port channels", (direction, maxQueue) => {
      expect(() => vld.validateChannelSpecs(make(direction, "Port", maxQueue))).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (maxQueue) => {
         const specs = make("RendererToRenderer", "Port", maxQueue);
         expect(() => vld.validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': maxQueue must be a non-negative integer or Infinity/,
         );
      },
   );

   it("rejects a number that is not a number", () => {
      expect(() =>
         vld.validateChannelSpecs(make("MainToRenderer", "Port", Number.NaN)),
      ).toThrowError(/maxQueue/);
      expect(() => vld.validateChannelSpecs(make("MainToRenderer", "Port", "10"))).toThrowError(
         /maxQueue/,
      );
   });

   it("rejects maxQueue on the channels that have no send queue", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Unicast"],
         ["RendererToMain", "Broadcast"],
         ["MainToRenderer", "Broadcast"],
         ["MainToRenderer", "Unicast"],
      ] as const) {
         expect(() => vld.validateChannelSpecs(make(direction, kind, 5))).toThrowError(/maxQueue/);
      }
   });
});

describe("validateChannelSpecs, timeoutMs", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      timeoutMs: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(
         direction,
         kind,
         kind === "Stream" ? "AsyncIterable<number>" : "void",
      );
      return [{ ...spec, timeoutMs } as Partial<t.ChannelSpec>];
   };

   it.each([0, 1, 30_000, Number.MAX_SAFE_INTEGER, undefined])(
      "accepts %s on invoke channels",
      (timeoutMs) => {
         const specs = make("RendererToMain", "Unicast", timeoutMs);
         expect(() => vld.validateChannelSpecs(specs)).not.toThrowError();
      },
   );

   it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (timeoutMs) => {
         const specs = make("RendererToMain", "Unicast", timeoutMs);
         expect(() => vld.validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': timeoutMs must be a non-negative integer/,
         );
      },
   );

   it("rejects a value that is not a number", () => {
      const specs = make("RendererToMain", "Unicast", "10");
      expect(() => vld.validateChannelSpecs(specs)).toThrowError(/timeoutMs/);
   });

   it("rejects timeoutMs on the channels that do not wait for a reply", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Broadcast"],
         ["RendererToMain", "Stream"],
         ["MainToRenderer", "Broadcast"],
         ["MainToRenderer", "Unicast"],
         ["RendererToRenderer", "Port"],
         ["MainToUtility", "Broadcast"],
         ["UtilityToMain", "Broadcast"],
      ] as const) {
         expect(() => vld.validateChannelSpecs(make(direction, kind, 5))).toThrowError(/timeoutMs/);
      }
   });

   it.each([
      ["MainToUtility", "Unicast"],
      ["UtilityToMain", "Unicast"],
      ["RendererToUtility", "Unicast"],
      ["RendererToUtility", "Stream"],
   ] as const)(
      "accepts timeoutMs on %s %s channels, and rejects a bad value",
      (direction, kind) => {
         for (const timeoutMs of [0, 1, 30_000]) {
            expect(() =>
               vld.validateChannelSpecs(make(direction, kind, timeoutMs)),
            ).not.toThrowError();
         }
         for (const timeoutMs of [-1, 1.5, Number.POSITIVE_INFINITY]) {
            expect(() => vld.validateChannelSpecs(make(direction, kind, timeoutMs))).toThrowError(
               /timeoutMs must be a non-negative integer/,
            );
         }
      },
   );
});

describe("validateOptionalConfig, utilityBindingsPath", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each(["utility.ts", "src/worker/ipc.ts", "worker/ipc.mts", "worker/ipc.cts", undefined])(
      "accepts %s",
      (utilityBindingsPath) => {
         expect(() =>
            vld.validateOptionalConfig({ ...config, utilityBindingsPath }),
         ).not.toThrowError();
      },
   );

   it("rejects an absolute path", () => {
      expect(() =>
         vld.validateOptionalConfig({ ...config, utilityBindingsPath: "/srv/ipc.ts" }),
      ).toThrowError("utilityBindingsPath must be relative to the project root");
   });

   it.each([
      "worker/ipc",
      "worker/ipc.js",
      "worker/ipc.d.ts",
      "worker/ipc.d.mts",
      "worker/ipc.d.cts",
      "",
   ])("rejects %j, since it is not the path of a .ts file", (utilityBindingsPath) => {
      expect(() => vld.validateOptionalConfig({ ...config, utilityBindingsPath })).toThrowError(
         "utilityBindingsPath must be the path of a .ts file",
      );
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() =>
         vld.validateOptionalConfig({ ...config, utilityBindingsPath: value }),
      ).toThrowError(/utilityBindingsPath/);
   });
});

describe("validateChannelSpecs, utility channels", () => {
   const generate = (direction: t.ChannelDirection, kind: t.ChannelKind, returnType = "void") =>
      new ChannelSpecGenerator().generate(direction, kind, returnType);

   it.each(["MainToUtility", "UtilityToMain"] as const)(
      "accepts a Unicast channel %s with any return type, and a Broadcast one which returns void",
      (direction) => {
         for (const returnType of ["void", "number", "Promise<string>"]) {
            expect(() =>
               vld.validateChannelSpecs([generate(direction, "Unicast", returnType)]),
            ).not.toThrowError();
         }
         for (const returnType of ["void", "Promise<void>"]) {
            expect(() =>
               vld.validateChannelSpecs([generate(direction, "Broadcast", returnType)]),
            ).not.toThrowError();
         }
      },
   );

   it("rejects a Broadcast channel to the utility process which returns a value", () => {
      expect(() =>
         vld.validateChannelSpecs([generate("MainToUtility", "Broadcast", "string")]),
      ).toThrowError("Channel return type 'string' not allowed when channel kind is 'Broadcast'");
   });

   it.each(["Port", "Stream"] as const)("rejects a %s channel with a utility direction", (kind) => {
      for (const direction of ["MainToUtility", "UtilityToMain"] as const) {
         const spec = generate(direction, kind);
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel kind '${kind}' is not allowed when channel direction is '${direction}'.`,
         );
      }
   });

   it("rejects the direction of a utility channel for the other verbs", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Unicast"],
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Broadcast"],
      ] as const) {
         expect(() => vld.validateChannelSpecs([generate(direction, kind)])).not.toThrowError(
            /Utility/,
         );
      }
      const wrong = { ...generate("MainToUtility", "Unicast"), direction: "ToUtility" };
      expect(() => vld.validateChannelSpecs([wrong as unknown as t.ChannelSpec])).toThrowError(
         /direction/,
      );
   });

   it("rejects the options of the other verbs", () => {
      const ref = { name: "args", exported: "args", fromPath: "./v" };
      for (const kind of ["Unicast", "Broadcast"] as const) {
         for (const extra of [
            { errors: { definition: "Error", customTypes: [] } },
            { allowedOrigins: ["app://."] },
            { validate: ref },
            { trigger: "focus" },
            { maxQueue: 5 },
         ]) {
            const [key] = Object.keys(extra);
            const spec = { ...generate("MainToUtility", kind), ...extra };
            expect(() => vld.validateChannelSpecs([spec])).toThrowError(new RegExp(key));
         }
      }
   });

   it("keeps the names of the utility channels unique among all channels", () => {
      const spec = generate("UtilityToMain", "Unicast");
      const clash = { ...generate("RendererToMain", "Broadcast"), name: spec.name };
      expect(() => vld.validateChannelSpecs([spec, clash])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});

describe("validateChannelSpecs, renderer to utility channels", () => {
   const generate = (kind: t.ChannelKind, returnType = "void", direction = "RendererToUtility") =>
      new ChannelSpecGenerator().generate(direction as t.ChannelDirection, kind, returnType);
   const chunked = () => generate("Stream", "AsyncIterable<number>");

   it("accepts a Unicast channel with any return type", () => {
      for (const returnType of ["void", "number", "Promise<string>"]) {
         expect(() =>
            vld.validateChannelSpecs([generate("Unicast", returnType)]),
         ).not.toThrowError();
      }
   });

   it("accepts a Stream channel with a chunk type, and error types for both", () => {
      expect(() => vld.validateChannelSpecs([chunked()])).not.toThrowError();
      const errors = { definition: "Error", customTypes: [] };
      expect(() => vld.validateChannelSpecs([{ ...chunked(), errors }])).not.toThrowError();
      expect(() =>
         vld.validateChannelSpecs([{ ...generate("Unicast"), errors }]),
      ).not.toThrowError();
   });

   it("rejects a Stream channel without a chunk type", () => {
      expect(() => vld.validateChannelSpecs([generate("Stream")])).toThrowError(/chunkType/);
   });

   it.each(["Broadcast", "Port"] as const)("rejects a %s channel", (kind) => {
      expect(() => vld.validateChannelSpecs([generate(kind)])).toThrowError(
         `Channel kind '${kind}' is not allowed when channel direction is 'RendererToUtility'.`,
      );
   });

   it("rejects the options of the other verbs", () => {
      const ref = { name: "args", exported: "args", fromPath: "./v" };
      for (const kind of ["Unicast", "Stream"] as const) {
         for (const extra of [
            { allowedOrigins: ["app://."] },
            { validate: ref },
            { trigger: "focus" },
            { maxQueue: 5 },
         ]) {
            const [key] = Object.keys(extra);
            const base = kind === "Stream" ? chunked() : generate(kind);
            expect(() => vld.validateChannelSpecs([{ ...base, ...extra }])).toThrowError(
               new RegExp(key),
            );
         }
      }
   });

   it("keeps the names unique among all channels", () => {
      const spec = generate("Unicast");
      const clash = { ...generate("Unicast", "void", "RendererToMain"), name: spec.name };
      expect(() => vld.validateChannelSpecs([spec, clash])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});

describe("validateOptionalConfig, serviceWorkerPreloadPath", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each([
      "sw-preload.ts",
      "src/worker/preload.ts",
      "worker/preload.mts",
      "worker/preload.cts",
      undefined,
   ])("accepts %s", (serviceWorkerPreloadPath) => {
      expect(() =>
         vld.validateOptionalConfig({ ...config, serviceWorkerPreloadPath }),
      ).not.toThrowError();
   });

   it("rejects an absolute path", () => {
      expect(() =>
         vld.validateOptionalConfig({ ...config, serviceWorkerPreloadPath: "/srv/sw.ts" }),
      ).toThrowError("serviceWorkerPreloadPath must be relative to the project root");
   });

   it.each([
      "worker/preload",
      "worker/preload.js",
      "worker/preload.d.ts",
      "worker/preload.d.mts",
      "worker/preload.d.cts",
      "",
   ])("rejects %j, since it is not the path of a .ts file", (serviceWorkerPreloadPath) => {
      expect(() =>
         vld.validateOptionalConfig({ ...config, serviceWorkerPreloadPath }),
      ).toThrowError("serviceWorkerPreloadPath must be the path of a .ts file");
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() =>
         vld.validateOptionalConfig({ ...config, serviceWorkerPreloadPath: value }),
      ).toThrowError(/serviceWorkerPreloadPath/);
   });
});

describe("validateChannelSpecs, service worker channels", () => {
   const generate = (direction: t.ChannelDirection, kind: t.ChannelKind, returnType = "void") =>
      new ChannelSpecGenerator().generate(direction, kind, returnType);

   it.each(["ServiceWorkerToMain", "MainToServiceWorker"] as const)(
      "accepts a Unicast channel %s with any return type, and a Broadcast one which returns void",
      (direction) => {
         for (const returnType of ["void", "number", "Promise<string>"]) {
            expect(() =>
               vld.validateChannelSpecs([generate(direction, "Unicast", returnType)]),
            ).not.toThrowError();
         }
         for (const returnType of ["void", "Promise<void>"]) {
            expect(() =>
               vld.validateChannelSpecs([generate(direction, "Broadcast", returnType)]),
            ).not.toThrowError();
         }
      },
   );

   it("rejects a Broadcast channel of a worker which returns a value", () => {
      expect(() =>
         vld.validateChannelSpecs([generate("ServiceWorkerToMain", "Broadcast", "string")]),
      ).toThrowError("Channel return type 'string' not allowed when channel kind is 'Broadcast'");
   });

   it.each(["Port", "Stream"] as const)("rejects a %s channel with a worker direction", (kind) => {
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         const spec = generate(direction, kind);
         expect(() => vld.validateChannelSpecs([spec])).toThrowError(
            `Channel kind '${kind}' is not allowed when channel direction is '${direction}'.`,
         );
      }
   });

   it("accepts allowedOrigins and error types for the channels that a worker calls only", () => {
      const errors = { definition: "Error", customTypes: [] };
      const allowedOrigins = ["app://main"];
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() =>
            vld.validateChannelSpecs([
               { ...generate("ServiceWorkerToMain", kind), allowedOrigins },
            ]),
         ).not.toThrowError();
         expect(() =>
            vld.validateChannelSpecs([
               { ...generate("MainToServiceWorker", kind), allowedOrigins },
            ]),
         ).toThrowError(/allowedOrigins/);
      }
      expect(() =>
         vld.validateChannelSpecs([{ ...generate("ServiceWorkerToMain", "Unicast"), errors }]),
      ).not.toThrowError();
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         expect(() =>
            vld.validateChannelSpecs([{ ...generate(direction, "Broadcast"), errors }]),
         ).toThrowError(/errors/);
      }
      expect(() =>
         vld.validateChannelSpecs([{ ...generate("MainToServiceWorker", "Unicast"), errors }]),
      ).toThrowError(/errors/);
   });

   it("rejects an allowedOrigins list that holds no origin", () => {
      const spec = generate("ServiceWorkerToMain", "Unicast");
      expect(() => vld.validateChannelSpecs([{ ...spec, allowedOrigins: [] }])).toThrowError(
         /at least one origin/,
      );
      expect(() =>
         vld.validateChannelSpecs([{ ...spec, allowedOrigins: ["app://main/path"] }]),
      ).toThrowError(/is not an origin/);
   });

   it("accepts a validator for the channels that a worker calls only", () => {
      const validate = { name: "args", exported: "args", fromPath: "./v" };
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() =>
            vld.validateChannelSpecs([{ ...generate("ServiceWorkerToMain", kind), validate }]),
         ).not.toThrowError();
         expect(() =>
            vld.validateChannelSpecs([{ ...generate("MainToServiceWorker", kind), validate }]),
         ).toThrowError(/validate/);
      }
   });

   it("accepts a timeout for the calls of a worker only, not for its messages or questions", () => {
      expect(() =>
         vld.validateChannelSpecs([
            { ...generate("ServiceWorkerToMain", "Unicast"), timeoutMs: 5 },
         ]),
      ).not.toThrowError();
      expect(() =>
         vld.validateChannelSpecs([
            { ...generate("ServiceWorkerToMain", "Unicast"), timeoutMs: -1 },
         ]),
      ).toThrowError(/timeoutMs must be a non-negative integer/);
      for (const spec of [
         generate("ServiceWorkerToMain", "Broadcast"),
         generate("MainToServiceWorker", "Unicast"),
         generate("MainToServiceWorker", "Broadcast"),
      ]) {
         expect(() => vld.validateChannelSpecs([{ ...spec, timeoutMs: 5 }])).toThrowError(
            /timeoutMs/,
         );
      }
   });

   it("rejects the other options", () => {
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         for (const kind of ["Unicast", "Broadcast"] as const) {
            for (const extra of [{ trigger: "focus" }, { maxQueue: 5 }, { scopes: ["a"] }]) {
               const [key] = Object.keys(extra);
               const spec = { ...generate(direction, kind), ...extra };
               expect(() => vld.validateChannelSpecs([spec])).toThrowError(new RegExp(key));
            }
         }
      }
   });

   it("rejects a direction that no worker verb has", () => {
      const wrong = { ...generate("MainToServiceWorker", "Unicast"), direction: "ToServiceWorker" };
      expect(() => vld.validateChannelSpecs([wrong as unknown as t.ChannelSpec])).toThrowError(
         /direction/,
      );
   });

   it("keeps the names of the worker channels unique among all channels", () => {
      const spec = generate("MainToServiceWorker", "Unicast");
      const clash = { ...generate("RendererToMain", "Broadcast"), name: spec.name };
      expect(() => vld.validateChannelSpecs([spec, clash])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});
