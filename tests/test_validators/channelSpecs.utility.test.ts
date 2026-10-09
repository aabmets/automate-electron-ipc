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
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateChannelSpecs, utility channels", () => {
   const generate = (direction: t.ChannelDirection, kind: t.ChannelKind, returnType = "void") =>
      new ChannelSpecGenerator().generate(direction, kind, returnType);

   it.each(["MainToUtility", "UtilityToMain"] as const)(
      "accepts a Unicast channel %s with any return type, and a Broadcast one which returns void",
      (direction) => {
         for (const returnType of ["void", "number", "Promise<string>"]) {
            expect(() =>
               validateChannelSpecs([generate(direction, "Unicast", returnType)]),
            ).not.toThrowError();
         }
         for (const returnType of ["void", "Promise<void>"]) {
            expect(() =>
               validateChannelSpecs([generate(direction, "Broadcast", returnType)]),
            ).not.toThrowError();
         }
      },
   );

   it("rejects a Broadcast channel to the utility process which returns a value", () => {
      expect(() =>
         validateChannelSpecs([generate("MainToUtility", "Broadcast", "string")]),
      ).toThrowError("Channel return type 'string' not allowed when channel kind is 'Broadcast'");
   });

   it.each(["Port", "Stream"] as const)("rejects a %s channel with a utility direction", (kind) => {
      for (const direction of ["MainToUtility", "UtilityToMain"] as const) {
         const spec = generate(direction, kind);
         expect(() => validateChannelSpecs([spec])).toThrowError(
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
         expect(() => validateChannelSpecs([generate(direction, kind)])).not.toThrowError(
            /Utility/,
         );
      }
      const wrong = { ...generate("MainToUtility", "Unicast"), direction: "ToUtility" };
      expect(() => validateChannelSpecs([wrong as unknown as t.ChannelSpec])).toThrowError(
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
            expect(() => validateChannelSpecs([spec])).toThrowError(new RegExp(key));
         }
      }
   });

   it("keeps the names of the utility channels unique among all channels", () => {
      const spec = generate("UtilityToMain", "Unicast");
      const clash = { ...generate("RendererToMain", "Broadcast"), name: spec.name };
      expect(() => validateChannelSpecs([spec, clash])).toThrowError(
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
         expect(() => validateChannelSpecs([generate("Unicast", returnType)])).not.toThrowError();
      }
   });

   it("accepts a Stream channel with a chunk type, and error types for both", () => {
      expect(() => validateChannelSpecs([chunked()])).not.toThrowError();
      const errors = { definition: "Error", customTypes: [] };
      expect(() => validateChannelSpecs([{ ...chunked(), errors }])).not.toThrowError();
      expect(() => validateChannelSpecs([{ ...generate("Unicast"), errors }])).not.toThrowError();
   });

   it("rejects a Stream channel without a chunk type", () => {
      expect(() => validateChannelSpecs([generate("Stream")])).toThrowError(/chunkType/);
   });

   it.each(["Broadcast", "Port"] as const)("rejects a %s channel", (kind) => {
      expect(() => validateChannelSpecs([generate(kind)])).toThrowError(
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
            expect(() => validateChannelSpecs([{ ...base, ...extra }])).toThrowError(
               new RegExp(key),
            );
         }
      }
   });

   it("keeps the names unique among all channels", () => {
      const spec = generate("Unicast");
      const clash = { ...generate("Unicast", "void", "RendererToMain"), name: spec.name };
      expect(() => validateChannelSpecs([spec, clash])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});
