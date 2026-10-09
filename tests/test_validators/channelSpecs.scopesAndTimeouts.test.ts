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

import { validateChannelSpecs } from "@src/channel-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

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
         validateChannelSpecs(make(direction, kind, ["settings", "plugin-host"])),
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
         expect(() => validateChannelSpecs(make(direction, kind, ["settings"]))).toThrowError(
            /scopes/,
         );
      },
   );

   it("accepts a channel without scopes", () => {
      const specs = [new ChannelSpecGenerator().generate("RendererToMain", "Unicast")];
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it.each(["settings", "a", "editor2", "plugin-host", "a-b-c", "x".repeat(32)])(
      "accepts '%s' as the name of a scope",
      (name) => {
         expect(() =>
            validateChannelSpecs(make("RendererToMain", "Unicast", [name])),
         ).not.toThrowError();
      },
   );

   it("rejects an empty list, since it would put the channel in no window", () => {
      expect(() => validateChannelSpecs(make("RendererToMain", "Unicast", []))).toThrowError(
         /at least one scope/,
      );
   });

   it("rejects 'default', which is the scope of the channels without scopes", () => {
      expect(() =>
         validateChannelSpecs(make("RendererToMain", "Unicast", ["settings", "default"])),
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
      expect(() => validateChannelSpecs(make("RendererToMain", "Unicast", [name]))).toThrowError(
         /is not a scope name/,
      );
   });

   it("rejects a scope that is listed twice", () => {
      expect(() =>
         validateChannelSpecs(make("RendererToMain", "Unicast", ["a", "b", "a"])),
      ).toThrowError(/scope 'a' is listed twice/);
   });

   it("rejects a value which is not an array of strings", () => {
      for (const value of ["settings", [1], { a: 1 }]) {
         expect(() =>
            validateChannelSpecs(make("RendererToMain", "Unicast", value)),
         ).toThrowError();
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
         expect(() => validateChannelSpecs(specs)).not.toThrowError();
      },
   );

   it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (timeoutMs) => {
         const specs = make("RendererToMain", "Unicast", timeoutMs);
         expect(() => validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': timeoutMs must be a non-negative integer/,
         );
      },
   );

   it("rejects a value that is not a number", () => {
      const specs = make("RendererToMain", "Unicast", "10");
      expect(() => validateChannelSpecs(specs)).toThrowError(/timeoutMs/);
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
         expect(() => validateChannelSpecs(make(direction, kind, 5))).toThrowError(/timeoutMs/);
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
            expect(() => validateChannelSpecs(make(direction, kind, timeoutMs))).not.toThrowError();
         }
         for (const timeoutMs of [-1, 1.5, Number.POSITIVE_INFINITY]) {
            expect(() => validateChannelSpecs(make(direction, kind, timeoutMs))).toThrowError(
               /timeoutMs must be a non-negative integer/,
            );
         }
      },
   );
});
