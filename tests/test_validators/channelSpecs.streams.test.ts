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
         expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
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
      expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
   });

   it("rejects every other direction", () => {
      for (const direction of ["MainToRenderer", "RendererToRenderer"] as const) {
         const spec = new ChannelSpecGenerator().generate(
            direction,
            "Stream",
            "AsyncIterable<number>",
         );
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `Channel kind 'Stream' is not allowed when channel direction is '${direction}'.`,
         );
      }
   });

   it("needs the chunk type that the parser reads from the return type", () => {
      const spec = generate();
      const { chunkType: _chunkType, chunkStart: _chunkStart, ...signature } = spec.signature;
      expect(() => validateChannelSpecs([{ ...spec, signature }])).toThrowError(
         /signature\.chunkType/,
      );
   });

   it("allows the chunk type only on a Stream channel", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      const signature = { ...spec.signature, chunkType: "number" };
      expect(() => validateChannelSpecs([{ ...spec, signature }])).toThrowError(
         /signature\.chunkType/,
      );
   });

   it("rejects the trigger and the queue size of other verbs", () => {
      for (const extra of [{ trigger: "focus" }, { maxQueue: 5 }]) {
         const [key] = Object.keys(extra);
         expect(() => validateChannelSpecs([{ ...generate(), ...extra }])).toThrowError(
            new RegExp(key),
         );
      }
   });

   it("does not require a void return type, and keeps the names unique among all channels", () => {
      const spec = generate("AsyncIterable<string>");
      const clash = { ...new ChannelSpecGenerator().generate("RendererToMain", "Broadcast") };
      expect(() => validateChannelSpecs([spec])).not.toThrowError();
      expect(() => validateChannelSpecs([spec, { ...clash, name: spec.name }])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });

   it("reports a chunk which cannot be cloned like any other part of a signature", () => {
      const spec = generate("AsyncIterable<() => void>");
      expect(() => validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         /Schema file 'ipc\/schema.ts': Channel 'vitestChannel_0': chunk type contains a function/,
      );
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
         validateChannelSpecs(make(direction, "Stream", highWaterMark)),
      ).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (highWaterMark) => {
         const specs = make("RendererToMain", "Stream", highWaterMark);
         expect(() => validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': highWaterMark must be a non-negative integer or Infinity/,
         );
      },
   );

   it("rejects a number that is not a number", () => {
      expect(() => validateChannelSpecs(make("RendererToMain", "Stream", Number.NaN))).toThrowError(
         /highWaterMark/,
      );
      expect(() => validateChannelSpecs(make("RendererToMain", "Stream", "10"))).toThrowError(
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
         expect(() => validateChannelSpecs(make(direction, kind, 5))).toThrowError(/highWaterMark/);
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
      expect(() => validateChannelSpecs(make(direction, "Port", maxQueue))).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects %s and names the channel and the file",
      (maxQueue) => {
         const specs = make("RendererToRenderer", "Port", maxQueue);
         expect(() => validateChannelSpecs(specs, "schema.ts")).toThrowError(
            /Schema file 'schema\.ts': Channel 'vitestChannel_0': maxQueue must be a non-negative integer or Infinity/,
         );
      },
   );

   it("rejects a number that is not a number", () => {
      expect(() => validateChannelSpecs(make("MainToRenderer", "Port", Number.NaN))).toThrowError(
         /maxQueue/,
      );
      expect(() => validateChannelSpecs(make("MainToRenderer", "Port", "10"))).toThrowError(
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
         expect(() => validateChannelSpecs(make(direction, kind, 5))).toThrowError(/maxQueue/);
      }
   });
});
