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

import { parseError, parseMap, parseOne } from "@testutils/channel-map-utils.js";
import { describe, expect, it } from "vitest";

describe("utility channels", () => {
   const verbs = ["callUtility", "notifyUtility", "callMain", "notifyMain"];

   it.each(["notifyUtility", "notifyMain"])(
      "rejects every option of %s, since it has none",
      (verb) => {
         expect(
            parseError(
               `export default defineChannels({ a: ${verb}<() => void>({ timeoutMs: 5 }) });`,
            ),
         ).toBe(
            `Schema file 'schema.ts': channel 'a': option 'timeoutMs' is not supported by '${verb}'.`,
         );
         expect(
            parseError(
               `export default defineChannels({ a: ${verb}<() => void>({ validate: v }) });`,
            ),
         ).toContain("option 'validate' is not supported");
      },
   );

   it.each(["callUtility", "callMain"])("rejects the options of %s except timeoutMs", (verb) => {
      for (const option of ["validate: v", 'allowedOrigins: ["app://."]', 'scopes: ["a"]']) {
         expect(
            parseError(`export default defineChannels({ a: ${verb}<() => void>({ ${option} }) });`),
         ).toContain(`option '${option.split(":")[0]}' is not supported by '${verb}'.`);
      }
   });

   it.each(["callUtility", "callMain"])("reads the timeoutMs option of %s", (verb) => {
      expect(parseOne(`a: ${verb}<() => void>({ timeoutMs: 1500 })`).timeoutMs).toBe(1500);
      expect(parseOne(`a: ${verb}<() => void>({ timeoutMs: 0 })`).timeoutMs).toBe(0);
      expect(parseOne(`a: ${verb}() as () => void`)).not.toHaveProperty("timeoutMs");
      expect(parseOne(`a: ${verb}({ timeoutMs: 7 }) as () => void`).timeoutMs).toBe(7);
   });

   it.each(["callUtility", "callMain"])(
      "rejects a timeoutMs of %s that is not a non-negative integer literal",
      (verb) => {
         for (const text of ["-1", "1.5", "ms", '"5"']) {
            expect(
               parseError(
                  `export default defineChannels({ a: ${verb}<() => void>({ timeoutMs: ${text} }) });`,
               ),
            ).toMatch(/option 'timeoutMs'/);
         }
      },
   );

   it.each(verbs)("rejects the error types of %s, which has one type argument", (verb) => {
      expect(
         parseError(`export default defineChannels({ a: ${verb}<() => void, Error>() });`),
      ).toBe(
         `Schema file 'schema.ts': channel 'a': '${verb}' takes exactly one type argument, the signature.`,
      );
   });

   it("keeps the types of the signature, to import them into the files of both sides", () => {
      const spec = parseOne("a: callUtility<(job: Job) => Promise<Summary>>()");
      expect(spec.signature?.customTypes).toStrictEqual(["Job", "Summary"]);
      expect(spec.signature?.async).toBe(true);
   });

   it("keeps a channel to the utility process next to the other channels of the map", () => {
      const { channelSpecs } = parseMap(`export default defineChannels({
         a: invoke<() => void>(),
         b: callUtility<() => void>(),
         c: notifyMain<() => void>(),
      });`);
      expect(channelSpecs.map((spec) => spec.direction)).toStrictEqual([
         "RendererToMain",
         "MainToUtility",
         "UtilityToMain",
      ]);
   });
});

describe("renderer to utility channels", () => {
   const verbs = ["invokeUtility", "streamUtility"];
   const signature = (verb: string) =>
      verb === "streamUtility" ? "(t: string) => AsyncIterable<Row>" : "(t: string) => Row";

   it.each(verbs)("reads the timeoutMs option of %s", (verb) => {
      expect(parseOne(`a: ${verb}<${signature(verb)}>({ timeoutMs: 2500 })`).timeoutMs).toBe(2500);
      expect(parseOne(`a: ${verb}<${signature(verb)}>({ timeoutMs: 0 })`).timeoutMs).toBe(0);
      expect(parseOne(`a: ${verb}({ timeoutMs: 9 }) as ${signature(verb)}`).timeoutMs).toBe(9);
      expect(parseOne(`a: ${verb}<${signature(verb)}>()`)).not.toHaveProperty("timeoutMs");
   });

   it.each(verbs)(
      "rejects a timeoutMs of %s that is not a non-negative integer literal",
      (verb) => {
         for (const text of ["-1", "1.5", "ms"]) {
            expect(
               parseError(
                  `export default defineChannels({ a: ${verb}<${signature(verb)}>({ timeoutMs: ${text} }) });`,
               ),
            ).toMatch(/option 'timeoutMs'/);
         }
      },
   );

   it.each(verbs)("rejects the options of %s except scopes and timeoutMs", (verb) => {
      for (const option of ["validate: v", 'allowedOrigins: ["app://."]']) {
         expect(
            parseError(
               `export default defineChannels({ a: ${verb}<${signature(verb)}>({ ${option} }) });`,
            ),
         ).toContain(`option '${option.split(":")[0]}' is not supported by '${verb}'.`);
      }
   });

   it.each(verbs)("takes the error types of %s as a second type argument", (verb) => {
      const spec = parseOne(`a: ${verb}<${signature(verb)}, NotFound | Denied>()`);
      expect(spec.errors).toMatchObject({ definition: "NotFound | Denied" });
      expect(spec.errors?.customTypes).toStrictEqual(["NotFound", "Denied"]);
      expect(spec.signature?.customTypes).toStrictEqual(["Row"]);
   });

   it.each(verbs)("accepts the as form of %s, which cannot declare error types", (verb) => {
      const spec = parseOne(`a: ${verb}() as ${signature(verb)}`);
      expect(spec.errors).toBeUndefined();
      expect(parseError(`export default defineChannels({ a: ${verb}<() => void, A, B>() });`)).toBe(
         `Schema file 'schema.ts': channel 'a': '${verb}' takes at most two type arguments, the signature and the error types.`,
      );
   });

   it("reads the chunk type of a stream, and requires an async iterable for it", () => {
      const spec = parseOne(
         "a: streamUtility<(t: string) => AsyncGenerator<Row, void, undefined>>()",
      );
      expect(spec.kind).toBe("Stream");
      expect(spec.signature?.chunkType).toBe("Row");
      expect(
         parseError("export default defineChannels({ a: streamUtility<() => Row[]>() });"),
      ).toContain("must return AsyncIterable<Chunk>");
   });

   it("keeps the call of a page to a utility process next to the other channels", () => {
      const { channelSpecs } = parseMap(`export default defineChannels({
         a: invoke<() => void>(),
         b: invokeUtility<() => void>(),
         c: callUtility<() => void>(),
      });`);
      expect(channelSpecs.map((spec) => spec.direction)).toStrictEqual([
         "RendererToMain",
         "RendererToUtility",
         "MainToUtility",
      ]);
   });
});
