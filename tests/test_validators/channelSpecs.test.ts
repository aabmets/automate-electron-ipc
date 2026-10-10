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

import { validateChannelSpecs } from "@src/validation/channel-validation.js";
import { validateTypeSpecs } from "@src/validation/global-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

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
         const retVal = validateChannelSpecs(channelSpecsArray);
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
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `Channel name '${name}' is not a plain identifier`,
         );
      }
   });

   // The 3 character, 'on' and lowercase rules came from the listener names, which are gone.
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
         expect(validateChannelSpecs([{ ...spec, name }])).toStrictEqual([{ ...spec, name }]);
      }
   });

   it("should reject channel names that are members of every object", () => {
      const names = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];
      for (const name of [...names, "__proto__", "toLocaleString", "propertyIsEnumerable"]) {
         const spec = { ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"), name };
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `Channel name '${name}' is reserved`,
         );
      }
   });

   it("should name the file and the channel when a channel name is reserved", () => {
      const spec = {
         ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"),
         name: "constructor",
      };
      expect(() => validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         "Schema file 'ipc/schema.ts': Channel name 'constructor' is reserved",
      );
   });

   it("should accept channel names that merely contain or extend a reserved name", () => {
      for (const name of ["constructors", "toStringify", "valueOfIt", "hasOwn"]) {
         const spec = { ...new ChannelSpecGenerator().generate("RendererToMain", "Unicast"), name };
         expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
      }
   });

   it("should throw Struct error when channel kind is not a known kind", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      const invalid = { ...spec, kind: "Pipe" } as unknown as t.ChannelSpec;
      expect(() => validateChannelSpecs([invalid])).toThrowError(
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
         expect(() => validateChannelSpecs([spec])).toThrowError(
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
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `Channel return type '${spec.signature.returnType}' not allowed when channel kind is '${spec.kind}'`,
         );
      }
   });

   // The check compared the text, so `Promise<void >` was rejected.
   it("should accept the void return types that the parser reports, whatever the spacing", () => {
      const csg = new ChannelSpecGenerator();
      for (const kind of ["Broadcast", "Port"] as const) {
         const direction = kind === "Port" ? "RendererToRenderer" : "RendererToMain";
         const spec = csg.generate(direction, kind, "Promise<void >");
         spec.signature.returnsVoid = true;
         expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
      }
   });

   it("should trust returnsVoid over the text of the return type", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Broadcast", "Foo");
      spec.signature.returnsVoid = false;
      expect(() => validateChannelSpecs([spec])).toThrowError(
         "Channel return type 'Foo' not allowed when channel kind is 'Broadcast'",
      );
   });

   it("should ignore whitespace when a spec has no returnsVoid", () => {
      const spec = new ChannelSpecGenerator().generate(
         "RendererToMain",
         "Broadcast",
         "Promise<void >",
      );
      expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
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
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects error types on every other channel", () => {
      for (const [direction, kind] of [
         ["RendererToMain", "Broadcast"],
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         const specs = make(direction, kind, errors);
         expect(() => validateChannelSpecs(specs)).toThrowError(/errors/);
      }
   });

   it("rejects error types which lack the text or the custom types", () => {
      for (const value of [{ definition: "X" }, { customTypes: [] }, "X", 5]) {
         const specs = make("RendererToMain", "Unicast", value);
         expect(() => validateChannelSpecs(specs)).toThrowError(/errors/);
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

      expect(() => validateTypeSpecs([spec], [channel])).toThrowError(
         /Type 'Hidden' is used by channel .* must be exported/,
      );
      expect(() => validateTypeSpecs([{ ...spec, isExported: true }], [channel])).not.toThrow();
   });
});

describe("validateChannelSpecs, ask channels", () => {
   const generate = (returnType = "void") =>
      new ChannelSpecGenerator().generate("MainToRenderer", "Unicast", returnType);

   it("accepts a Unicast channel from the main process to a renderer, with any return type", () => {
      for (const returnType of ["void", "boolean", "Promise<Document>", "Promise<void>"]) {
         expect(() => validateChannelSpecs([generate(returnType)])).not.toThrowError();
      }
   });

   it("still rejects a Unicast channel between two renderers", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToRenderer", "Unicast");
      expect(() => validateChannelSpecs([spec])).toThrowError(
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
         expect(() => validateChannelSpecs([{ ...generate(), ...extra }])).toThrowError(
            new RegExp(key),
         );
      }
   });

   it("keeps the names of the asks unique among all channels", () => {
      const spec = generate();
      const clash = { ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast") };
      expect(() => validateChannelSpecs([spec, { ...clash, name: spec.name }])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});
