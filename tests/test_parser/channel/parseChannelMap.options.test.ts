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

import { parseError, parseMap, parseOne } from "@testutils/parser/channel-map-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule, error types", () => {
   const withImports = (code: string) =>
      parseMap(`import type { NotFoundError, AuthError } from "./errors";\n${code}`);
   const one = (entry: string): Partial<t.ChannelSpec> =>
      withImports(`export default defineChannels({ ${entry} });`).channelSpecs[0];

   it("takes the second type argument of invoke as the error types", () => {
      const spec = one(
         "getUser: invoke<(id: number) => Promise<string>, NotFoundError | AuthError>()",
      );

      expect(spec.signature?.definition).toBe("(id: number) => Promise<string>");
      expect(spec.errors).toMatchObject({
         definition: "NotFoundError | AuthError",
         customTypes: ["NotFoundError", "AuthError"],
      });
   });

   it("has no errors without the second type argument", () => {
      expect(one("getUser: invoke<() => void>()").errors).toBeUndefined();
      expect(one("getUser: invoke() as () => void").errors).toBeUndefined();
   });

   it("keeps the text of the type as written, without the parentheses around it", () => {
      const spec = one("getUser: invoke<() => void, ( NotFoundError | AuthError )>()");
      expect(spec.errors?.definition).toBe("NotFoundError | AuthError");
   });

   it("records the position of each type name, for the writers to rename", () => {
      const spec = one("getUser: invoke<() => void, NotFoundError | AuthError>()");

      expect(spec.errors?.typeRefs).toStrictEqual([
         { name: "NotFoundError", start: 0, end: 13 },
         { name: "AuthError", start: 16, end: 25 },
      ]);
   });

   it("collects the leftmost name of a qualified error type", () => {
      const out = parseMap(
         'import type * as Errors from "./errors";\n' +
            "export default defineChannels({ getUser: invoke<() => void, Errors.NotFound>() });",
      );

      expect(out.channelSpecs[0].errors?.customTypes).toStrictEqual(["Errors.NotFound"]);
      expect(out.channelSpecs[0].errors?.typeRefs).toStrictEqual([
         { name: "Errors", start: 0, end: 6 },
      ]);
   });

   it("collects an error class which the schema file declares", () => {
      const out = parseMap(
         "export class NotFound extends Error {}\n" +
            "export default defineChannels({ getUser: invoke<() => void, NotFound>() });",
      );

      expect(out.channelSpecs[0].errors?.customTypes).toStrictEqual(["NotFound"]);
   });

   it("does not collect the built-in Error as a custom type", () => {
      const spec = one("getUser: invoke<() => void, Error>()");

      expect(spec.errors?.customTypes).toStrictEqual([]);
      expect(spec.errors?.definition).toBe("Error");
   });

   it("keeps the errors apart from the types of the signature", () => {
      const spec = one("getUser: invoke<(id: NotFoundError) => void, AuthError>()");

      expect(spec.signature?.customTypes).toStrictEqual(["NotFoundError"]);
      expect(spec.errors?.customTypes).toStrictEqual(["AuthError"]);
   });
});

describe("parseChannelMapModule, timeoutMs", () => {
   it("reads a non-negative integer literal on invoke", () => {
      for (const [text, value] of [
         ["0", 0],
         ["500", 500],
         ["1e3", 1000],
         ["(5)", 5],
      ] as const) {
         const spec = parseOne(`chan: invoke<(a: string) => void>({ timeoutMs: ${text} })`);
         expect(spec.timeoutMs).toBe(value);
      }
   });

   it("reads the option of the alternative form", () => {
      const spec = parseOne("chan: invoke({ timeoutMs: 7 }) as (a: string) => void");
      expect(spec.timeoutMs).toBe(7);
   });

   it("leaves the option out when it is not given, so that the config default applies", () => {
      expect(parseOne("chan: invoke<() => void>()")).not.toHaveProperty("timeoutMs");
      expect(parseOne("chan: invoke<() => void>({})")).not.toHaveProperty("timeoutMs");
   });

   it.each(["-1", "1.5", "1e400", "9007199254740993", "+1", "NaN", "Infinity", '"10"', "limit"])(
      "rejects %s, naming the channel",
      (text) => {
         const message = parseError(
            `export default defineChannels({ chan: invoke<() => void>({ timeoutMs: ${text} }) });`,
         );
         expect(message).toMatch(/chan/);
         expect(message).toMatch(/timeoutMs/);
      },
   );

   it.each(["send", "stream", "emit", "ask", "port", "mainPort"])(
      "rejects the option on %s, which has no reply to wait for",
      (verb) => {
         const message = parseError(
            `export default defineChannels({ chan: ${verb}<() => void>({ timeoutMs: 5 }) });`,
         );
         expect(message).toMatch(/option 'timeoutMs' is not supported by/);
      },
   );
});

describe("parseChannelMapModule, maxQueue", () => {
   it.each(["port", "mainPort"])("reads a non-negative integer literal on %s", (verb) => {
      for (const [text, value] of [
         ["0", 0],
         ["1", 1],
         ["1000", 1000],
         ["1e3", 1000],
         ["(5)", 5],
      ] as const) {
         const spec = parseOne(`chan: ${verb}<(a: string) => void>({ maxQueue: ${text} })`);
         expect(spec.maxQueue).toBe(value);
      }
   });

   it.each(["port", "mainPort"])("reads Infinity on %s", (verb) => {
      const spec = parseOne(`chan: ${verb}<(a: string) => void>({ maxQueue: Infinity })`);
      expect(spec.maxQueue).toBe(Number.POSITIVE_INFINITY);
   });

   it("reads the option of the alternative form", () => {
      const spec = parseOne("chan: port({ maxQueue: 7 }) as (a: string) => void");
      expect(spec.maxQueue).toBe(7);
   });

   it("leaves the option out when it is not given, so that the default applies", () => {
      expect(parseOne("chan: port<() => void>()")).not.toHaveProperty("maxQueue");
      expect(parseOne("chan: mainPort<() => void>({})")).not.toHaveProperty("maxQueue");
   });

   it.each(["-1", "-0", "1.5", "0.5", "1e400", "9007199254740993", "+1", "NaN", "-Infinity"])(
      "rejects %s, naming the channel",
      (text) => {
         const message = parseError(
            `export default defineChannels({ chan: port<() => void>({ maxQueue: ${text} }) });`,
         );
         expect(message).toMatch(/chan/);
         expect(message).toMatch(/maxQueue/);
      },
   );

   it.each(['"10"', "true", "null", "limit", "1000 + 1", "Number.MAX_VALUE", "[1]"])(
      "rejects %s, which is not a number literal",
      (text) => {
         const message = parseError(
            `const limit = 3; export default defineChannels({ chan: mainPort<() => void>({ maxQueue: ${text} }) });`,
         );
         expect(message).toMatch(
            /option 'maxQueue' must be a non-negative integer literal or Infinity/,
         );
         expect(message).toMatch(/chan/);
      },
   );

   it.each([
      "invoke<() => Promise<void>>",
      "send<() => void>",
      "emit<() => void>",
      "ask<() => void>",
   ])("is not an option of %s", (verb) => {
      const message = parseError(
         `export default defineChannels({ chan: ${verb}({ maxQueue: 5 }) });`,
      );
      expect(message).toMatch(/option 'maxQueue' is not supported by/);
   });

   it("names the size limit for numbers beyond the safe integers", () => {
      const message = parseError(
         "export default defineChannels({ chan: port<() => void>({ maxQueue: 9007199254740993 }) });",
      );
      expect(message).toMatch(/cannot exceed 9007199254740991\. Use Infinity/);
   });
});
