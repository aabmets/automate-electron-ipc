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
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule, scopes", () => {
   const wrap = (entry: string) => `export default defineChannels({ ${entry} });`;
   const signatures: Record<string, string> = {
      invoke: "() => Promise<void>",
      send: "() => void",
      emit: "() => void",
      ask: "() => boolean",
      stream: "() => AsyncIterable<number>",
      port: "() => void",
      mainPort: "() => void",
      invokeUtility: "() => Promise<void>",
      streamUtility: "() => AsyncIterable<number>",
   };

   it.each(Object.keys(signatures))("reads scopes of %s, in the order they are written", (verb) => {
      const spec = parseOne(
         `chan: ${verb}<${signatures[verb]}>({ scopes: ["settings", "editor"] })`,
      );
      expect(spec.scopes).toStrictEqual(["settings", "editor"]);
   });

   it("reads scopes of the form with `as`, through parentheses, and next to other options", () => {
      expect(parseOne('chan: send({ scopes: ["a"] }) as () => void').scopes).toStrictEqual(["a"]);
      expect(parseOne("chan: send<() => void>({ scopes: (['a']) })").scopes).toStrictEqual(["a"]);
      const spec = parseOne(
         'chan: invoke<() => void>({ allowedOrigins: ["app://."], timeoutMs: 5, scopes: ["a", "b"] })',
      );
      expect(spec).toMatchObject({ allowedOrigins: ["app://."], timeoutMs: 5, scopes: ["a", "b"] });
   });

   it("does not set scopes when none are given", () => {
      expect(parseOne("chan: invoke<() => void>()")).not.toHaveProperty("scopes");
      expect(parseOne("chan: invoke<() => void>({})")).not.toHaveProperty("scopes");
   });

   it("leaves the names to the validator, so that an empty list reaches it", () => {
      expect(parseOne("chan: send<() => void>({ scopes: [] })").scopes).toStrictEqual([]);
      expect(parseOne('chan: send<() => void>({ scopes: ["Not A Scope"] })').scopes).toStrictEqual([
         "Not A Scope",
      ]);
   });

   it("rejects scopes that are not an array of string literals", () => {
      for (const value of [
         '"settings"',
         "scopes",
         "[scope]",
         '[...scopes, "a"]',
         '["a", , "b"]',
         "[`a`]",
         "[1]",
      ]) {
         const msg = parseError(wrap(`chan: send<() => void>({ scopes: ${value} })`));
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain("option 'scopes' must be an array of string literals");
      }
   });

   it.each(["callUtility", "notifyUtility", "callMain", "notifyMain"])(
      "rejects scopes on %s, since a page has no part in it",
      (verb) => {
         const msg = parseError(wrap(`chan: ${verb}<() => void>({ scopes: ["a"] })`));
         expect(msg).toContain(`option 'scopes' is not supported by '${verb}'`);
      },
   );
});

describe("service worker channels", () => {
   const verbs = [
      ["invokeFromWorker", "Unicast", "ServiceWorkerToMain"],
      ["sendFromWorker", "Broadcast", "ServiceWorkerToMain"],
      ["askWorker", "Unicast", "MainToServiceWorker"],
      ["emitToWorker", "Broadcast", "MainToServiceWorker"],
   ] as const;

   it.each(verbs)("reads %s as a %s channel with the direction %s", (verb, kind, direction) => {
      const spec = parseOne(
         `a: ${verb}<(id: number) => ${kind === "Broadcast" ? "void" : "string"}>()`,
      );
      expect(spec).toMatchObject({ name: "a", kind, direction });
      expect(spec.signature?.params).toHaveLength(1);
   });

   it("reads allowedOrigins of the channels that a worker calls", () => {
      for (const verb of ["invokeFromWorker", "sendFromWorker"]) {
         const returns = verb === "sendFromWorker" ? "void" : "string";
         const spec = parseOne(
            `a: ${verb}<() => ${returns}>({ allowedOrigins: ["app://main", "http://localhost:5173"] })`,
         );
         expect(spec.allowedOrigins).toStrictEqual(["app://main", "http://localhost:5173"]);
      }
   });

   it.each([
      ["invokeFromWorker", 'scopes: ["a"]'],
      ["sendFromWorker", "timeoutMs: 5"],
      ["sendFromWorker", 'scopes: ["a"]'],
      ["askWorker", 'allowedOrigins: ["app://."]'],
      ["askWorker", "timeoutMs: 5"],
      ["askWorker", "validate: v"],
      ["emitToWorker", "validate: v"],
      ["emitToWorker", 'scopes: ["a"]'],
      ["emitToWorker", 'trigger: "focus"'],
   ])("rejects the option of another verb: %s with %s", (verb, option) => {
      expect(
         parseError(`export default defineChannels({ a: ${verb}<() => void>({ ${option} }) });`),
      ).toContain(`option '${option.split(":")[0]}' is not supported by '${verb}'.`);
   });

   it("reads validate and timeoutMs of invokeFromWorker, and validate of sendFromWorker", () => {
      const imports = `${IMPORT}\nimport { idArgs } from "./validators";`;
      const specOf = (entry: string) =>
         parseMap(`export default defineChannels({ ${entry} });`, imports).channelSpecs[0];
      const call = specOf(
         "a: invokeFromWorker<(id: number) => string>({ validate: idArgs, timeoutMs: 800 })",
      );
      const expected = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
      expect(call.validate).toStrictEqual(expected);
      expect(call.timeoutMs).toBe(800);
      const send = specOf(
         'a: sendFromWorker<(id: number) => void>({ validate: idArgs, allowedOrigins: ["app://."] })',
      );
      expect(send.validate).toStrictEqual(expected);
      expect(send.allowedOrigins).toStrictEqual(["app://."]);
      expect(send.timeoutMs).toBeUndefined();
   });

   it.each([
      ["invokeFromWorker", "timeoutMs: -1", "must be a non-negative integer literal"],
      ["invokeFromWorker", "timeoutMs: 1.5", "must be a non-negative integer literal"],
      ["invokeFromWorker", "timeoutMs: slow", "must be a non-negative integer literal"],
      [
         "invokeFromWorker",
         "validate: () => 1",
         "must be an identifier which the schema file imports",
      ],
      ["sendFromWorker", "validate: 5", "must be an identifier which the schema file imports"],
   ])("rejects a bad value: %s with %s", (verb, option, message) => {
      expect(
         parseError(`export default defineChannels({ a: ${verb}<() => void>({ ${option} }) });`),
      ).toContain(message);
   });

   it("takes the error types of invokeFromWorker as a second type argument", () => {
      const spec = parseOne(
         "a: invokeFromWorker<(id: number) => Promise<Token>, NotSignedIn | Denied>()",
      );
      expect(spec.errors).toMatchObject({ definition: "NotSignedIn | Denied" });
      expect(spec.errors?.customTypes).toStrictEqual(["NotSignedIn", "Denied"]);
      expect(spec.signature?.customTypes).toStrictEqual(["Token"]);
   });

   it.each(["sendFromWorker", "askWorker", "emitToWorker"])(
      "rejects the error types of %s, which has one type argument",
      (verb) => {
         expect(
            parseError(`export default defineChannels({ a: ${verb}<() => void, Error>() });`),
         ).toBe(
            `Schema file 'schema.ts': channel 'a': '${verb}' takes exactly one type argument, the signature.`,
         );
      },
   );

   it("accepts the as form of the verbs", () => {
      const spec = parseOne("a: invokeFromWorker() as (id: number) => Promise<Token>");
      expect(spec).toMatchObject({ kind: "Unicast", direction: "ServiceWorkerToMain" });
      expect(spec.signature?.customTypes).toStrictEqual(["Token"]);
   });

   it("keeps the channels of a worker next to the other channels of the map", () => {
      const { channelSpecs } = parseMap(`export default defineChannels({
         a: invoke<() => void>(),
         b: invokeFromWorker<() => void>(),
         c: emitToWorker<() => void>(),
         d: callUtility<() => void>(),
      });`);
      expect(channelSpecs.map((spec) => spec.direction)).toStrictEqual([
         "RendererToMain",
         "ServiceWorkerToMain",
         "MainToServiceWorker",
         "MainToUtility",
      ]);
   });
});
