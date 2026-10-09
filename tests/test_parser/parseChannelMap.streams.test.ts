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

import { IMPORT, parseError, parseMap, parseOne } from "@testutils/channel-map-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule, highWaterMark", () => {
   const verbs = ["stream", "streamUtility"];

   it.each(verbs)("reads a non-negative integer literal on %s", (verb) => {
      for (const [text, value] of [
         ["0", 0],
         ["1", 1],
         ["1024", 1024],
         ["1e3", 1000],
         ["(5)", 5],
      ] as const) {
         const spec = parseOne(
            `chan: ${verb}<() => AsyncIterable<number>>({ highWaterMark: ${text} })`,
         );
         expect(spec.highWaterMark).toBe(value);
      }
   });

   it.each(verbs)("reads Infinity on %s", (verb) => {
      const spec = parseOne(
         `chan: ${verb}<() => AsyncIterable<number>>({ highWaterMark: Infinity })`,
      );
      expect(spec.highWaterMark).toBe(Number.POSITIVE_INFINITY);
   });

   it("reads the option of the alternative form", () => {
      const spec = parseOne("chan: stream({ highWaterMark: 7 }) as () => AsyncIterable<number>");
      expect(spec.highWaterMark).toBe(7);
   });

   it("reads it next to the other options of the stream", () => {
      const spec = parseOne(
         'chan: stream<() => AsyncIterable<number>>({ highWaterMark: 2, allowedOrigins: ["app://."], scopes: ["a"] })',
      );
      expect(spec).toMatchObject({
         highWaterMark: 2,
         allowedOrigins: ["app://."],
         scopes: ["a"],
      });
   });

   it("leaves the option out when it is not given, so that the default applies", () => {
      expect(parseOne("chan: stream<() => AsyncIterable<number>>()")).not.toHaveProperty(
         "highWaterMark",
      );
      expect(parseOne("chan: streamUtility<() => AsyncIterable<number>>({})")).not.toHaveProperty(
         "highWaterMark",
      );
   });

   it.each(["-1", "-0", "1.5", "1e400", "9007199254740993", "+1", "NaN", "-Infinity"])(
      "rejects %s, naming the channel and the option",
      (text) => {
         const message = parseError(
            `export default defineChannels({ chan: stream<() => AsyncIterable<number>>({ highWaterMark: ${text} }) });`,
         );
         expect(message).toMatch(/chan/);
         expect(message).toMatch(/highWaterMark/);
      },
   );

   it.each(['"10"', "true", "null", "limit", "1000 + 1", "[1]"])(
      "rejects %s, which is not a number literal",
      (text) => {
         const message = parseError(
            `const limit = 3; export default defineChannels({ chan: streamUtility<() => AsyncIterable<number>>({ highWaterMark: ${text} }) });`,
         );
         expect(message).toMatch(
            /option 'highWaterMark' must be a non-negative integer literal or Infinity/,
         );
      },
   );

   it("names the size limit for numbers beyond the safe integers", () => {
      const message = parseError(
         "export default defineChannels({ chan: stream<() => AsyncIterable<number>>({ highWaterMark: 9007199254740993 }) });",
      );
      expect(message).toMatch(/cannot exceed 9007199254740991\. Use Infinity/);
      expect(message).toMatch(/option 'highWaterMark'/);
   });

   it.each([
      "invoke<() => Promise<void>>",
      "send<() => void>",
      "emit<() => void>",
      "ask<() => void>",
      "port<() => void>",
      "invokeUtility<() => void>",
   ])("is not an option of %s", (verb) => {
      const message = parseError(
         `export default defineChannels({ chan: ${verb}({ highWaterMark: 5 }) });`,
      );
      expect(message).toMatch(/option 'highWaterMark' is not supported by/);
   });
});

describe("stream channels", () => {
   const wrapStream = (entry: string) => `export default defineChannels({ ${entry} });`;

   it("parses the generic form into a Stream channel from the renderer to the main process", () => {
      const spec = parseOne("chan: stream<(table: string) => AsyncIterable<Row>>()");
      expect(spec).toMatchObject({ name: "chan", kind: "Stream", direction: "RendererToMain" });
      expect(spec.signature).toMatchObject({
         definition: "(table: string) => AsyncIterable<Row>",
         returnType: "AsyncIterable<Row>",
         chunkType: "Row",
         customTypes: ["Row"],
         async: false,
      });
   });

   it("gives the generic form, the as form and an empty config the same spec", () => {
      const generic = parseOne("chan: stream<(a: Foo, b?: number) => AsyncIterable<Bar>>()");
      expect(
         parseOne("chan: stream() as (a: Foo, b?: number) => AsyncIterable<Bar>"),
      ).toStrictEqual(generic);
      expect(
         parseOne("chan: stream<(a: Foo, b?: number) => AsyncIterable<Bar>>({})"),
      ).toStrictEqual(generic);
   });

   it.each([
      ["AsyncIterable<number>", "number"],
      ["AsyncIterableIterator<number>", "number"],
      ["AsyncGenerator<number>", "number"],
      ["AsyncGenerator<number, void, undefined>", "number"],
      ["AsyncIterable<{ a: string; b: Foo[] }>", "{ a: string; b: Foo[] }"],
      ["AsyncIterable<[number, string]>", "[number, string]"],
      ["AsyncIterable<Map<string, number>>", "Map<string, number>"],
      ["(AsyncIterable<number>)", "number"],
   ])("reads the chunk type of %s", (returnType, chunkType) => {
      const spec = parseOne(`chan: stream<() => ${returnType}>()`);
      expect(spec.signature?.chunkType).toBe(chunkType);
      expect(spec.signature?.returnType).toBe(returnType);
   });

   it("records where the chunk type starts in the definition", () => {
      const spec = parseOne("chan: stream<(id: number) => AsyncIterable<Foo>>()");
      const { definition, chunkStart, chunkType } = spec.signature as t.CallableSignature;
      expect(definition.slice(chunkStart, (chunkStart ?? 0) + (chunkType?.length ?? 0))).toBe(
         "Foo",
      );
   });

   it("keeps the parameters, optional and rest ones included, and generic signatures", () => {
      const spec = parseOne(
         "chan: stream<<T>(seed: T, limit?: number, ...rest: string[]) => AsyncIterable<T>>()",
      );
      expect(
         spec.signature?.params.map((param) => [param.name, param.optional, param.rest]),
      ).toStrictEqual([
         ["seed", false, false],
         ["limit", true, false],
         ["rest", false, true],
      ]);
      expect(spec.signature?.chunkType).toBe("T");
   });

   it("reads the options allowedOrigins and validate", () => {
      const spec = parseMap(
         wrapStream(
            'chan: stream<(n: number) => AsyncIterable<number>>({ allowedOrigins: ["app://."], validate: countArgs })',
         ),
         `${IMPORT}\nimport { countArgs } from "./v";`,
      ).channelSpecs[0];
      expect(spec.allowedOrigins).toStrictEqual(["app://."]);
      expect(spec.validate).toStrictEqual({
         name: "countArgs",
         exported: "countArgs",
         fromPath: "./v",
      });
   });

   it("reads the error types of the second type argument", () => {
      const spec = parseOne(
         "chan: stream<() => AsyncIterable<number>, NotFoundError | AuthError>()",
      );
      expect(spec.errors).toMatchObject({
         definition: "NotFoundError | AuthError",
         customTypes: ["NotFoundError", "AuthError"],
      });
   });

   it("rejects a signature which does not return an async iterable", () => {
      for (const returnType of [
         "void",
         "number",
         "Promise<AsyncIterable<number>>",
         "Iterable<number>",
         "ReadableStream<number>",
         "Foo.AsyncIterable<number>",
         "AsyncIterable",
         "AsyncIterable<number>[]",
         "Foo",
      ]) {
         const msg = parseError(wrapStream(`chan: stream<() => ${returnType}>()`));
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain(
            "must return AsyncIterable<Chunk>, AsyncIterableIterator<Chunk> or AsyncGenerator<Chunk>",
         );
         expect(msg).toContain(`found '${returnType}'`);
      }
   });

   it("rejects a user type that is named like an async iterable", () => {
      const msg = parseError(
         "interface AsyncIterable<T> { items: T[] }\n" +
            wrapStream("chan: stream<() => AsyncIterable<number>>()"),
      );
      expect(msg).toContain("must return AsyncIterable<Chunk>");
   });

   it("names the verb in the error of the as form too", () => {
      expect(parseError(wrapStream("chan: stream() as () => string"))).toContain(
         "the signature of 'stream' must return",
      );
   });

   it.each([
      ["a function", "() => void"],
      ["a symbol", "symbol"],
      ["a WeakMap", "WeakMap<object, number>"],
   ])("reports %s as a chunk that cannot be cloned", (reason, chunk) => {
      const spec = parseOne(`chan: stream<() => AsyncIterable<${chunk}>>()`);
      expect(spec.signature?.cloneIssues).toStrictEqual([
         { level: "error", where: "chunk type", type: chunk, reason },
      ]);
   });

   it("checks the chunk type of the other iterable return types, and the parameters as usual", () => {
      const generator = parseOne(
         "chan: stream<() => AsyncGenerator<() => void, void, undefined>>()",
      );
      expect(generator.signature?.cloneIssues?.[0]).toMatchObject({ where: "chunk type" });
      const param = parseOne("chan: stream<(cb: () => void) => AsyncIterable<number>>()");
      expect(param.signature?.cloneIssues?.[0]).toMatchObject({ where: "parameter 'cb'" });
   });

   it("does not check the generator types which are not sent", () => {
      const spec = parseOne("chan: stream<() => AsyncGenerator<number, () => void, () => void>>()");
      expect(spec.signature?.cloneIssues).toBeUndefined();
   });

   it("does not set the chunk type for the other verbs, even when they return an async iterable", () => {
      expect(parseOne("chan: invoke<() => AsyncIterable<number>>()").signature).not.toHaveProperty(
         "chunkType",
      );
   });

   it("does not support the options of the other verbs", () => {
      for (const option of ['trigger: "focus"', "maxQueue: 5"]) {
         const msg = parseError(
            wrapStream(`chan: stream<() => AsyncIterable<number>>({ ${option} })`),
         );
         expect(msg).toContain("is not supported by 'stream'");
      }
   });

   it("accepts at most two type arguments", () => {
      expect(
         parseError(wrapStream("chan: stream<() => AsyncIterable<number>, Error, string>()")),
      ).toContain("at most two type arguments");
   });
});
