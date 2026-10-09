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

import { parseError, parseMap } from "@testutils/parser/channel-map-utils.js";
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule", () => {
   describe("errors", () => {
      const wrap = (entry: string) => `export default defineChannels({ ${entry} });`;

      it("rejects a missing signature", () => {
         for (const entry of ["chan: invoke()", "chan: invoke({})"]) {
            const msg = parseError(wrap(entry));
            expect(msg).toContain("schema.ts");
            expect(msg).toContain("channel 'chan'");
            expect(msg).toContain("no signature");
         }
      });

      it("rejects a signature given in both forms", () => {
         const msg = parseError(wrap("chan: invoke<() => void>() as () => void"));
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain("given twice");
      });

      it("rejects more than two type arguments of invoke, and a second one of the other verbs", () => {
         expect(parseError(wrap("chan: invoke<() => void, Error, string>()"))).toContain(
            "at most two type arguments",
         );
         for (const verb of ["send", "emit", "ask", "port", "mainPort"]) {
            const msg = parseError(wrap(`chan: ${verb}<() => void, Error>()`));
            expect(msg).toContain("exactly one type argument");
         }
      });

      it("rejects the second type argument together with the as form", () => {
         for (const entry of [
            "chan: invoke<() => void, Error>() as () => void",
            "chan: invoke<() => void>() as () => void",
         ]) {
            expect(parseError(wrap(entry))).toContain("Use only one of them");
         }
         expect(parseError(wrap("chan: invoke<() => void, Error>() as () => void"))).toContain(
            "Error types need the type argument form",
         );
      });

      it("rejects a signature that is not a function type", () => {
         for (const entry of [
            "chan: invoke() as string",
            "chan: invoke<string>()",
            "chan: invoke() as Foo",
         ]) {
            const msg = parseError(wrap(entry));
            expect(msg).toContain("channel 'chan'");
            expect(msg).toContain("must be a function type");
         }
      });

      it("rejects an unknown verb", () => {
         const msg = parseError(wrap("chan: pipe<() => void>()"));
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain("unknown verb 'pipe'");
      });

      it("rejects values that are not verb calls", () => {
         for (const entry of ["chan: 123", "chan: invoke", "chan: someValue"]) {
            const msg = parseError(wrap(entry));
            expect(msg).toContain("channel 'chan'");
            expect(msg).toContain("expected a call to one of");
         }
      });

      it("rejects a spread element", () => {
         const msg = parseError(wrap("...others"));
         expect(msg).toContain("schema.ts");
         expect(msg).toContain("spread");
      });

      it("rejects computed, string, numeric and shorthand keys", () => {
         for (const entry of [
            "[name]: invoke<() => void>()",
            '"chan": invoke<() => void>()',
            "123: invoke<() => void>()",
            "chan",
            "chan() {}",
         ]) {
            const msg = parseError(wrap(entry));
            expect(msg).toContain("plain identifier keys");
         }
      });

      it("rejects a nested object", () => {
         const msg = parseError(wrap("group: { chan: invoke<() => void>() }"));
         expect(msg).toContain("channel 'group'");
         expect(msg).toContain("nested objects");
      });

      it("rejects options that the verb does not support", () => {
         for (const verb of ["invoke", "send", "ask", "port", "mainPort"]) {
            const msg = parseError(wrap(`chan: ${verb}<() => void>({ trigger: "focus" })`));
            expect(msg).toContain("channel 'chan'");
            expect(msg).toContain(`option 'trigger' is not supported by '${verb}'`);
         }
         const msg = parseError(wrap("chan: emit<() => void>({ other: 1 })"));
         expect(msg).toContain("option 'other' is not supported by 'emit'");
      });

      it("rejects a config that is not a single object literal", () => {
         for (const entry of [
            "chan: invoke<() => void>(opts)",
            "chan: invoke<() => void>({}, {})",
            "chan: invoke<() => void>(...opts)",
         ]) {
            expect(parseError(wrap(entry))).toContain("one optional config object literal");
         }
      });

      it("rejects a config key that is not an identifier", () => {
         expect(parseError(wrap('chan: emit<() => void>({ "trigger": "focus" })'))).toContain(
            "config keys must be plain identifiers",
         );
         expect(parseError(wrap("chan: emit<() => void>({ ...opts })"))).toContain(
            "config keys must be plain identifiers",
         );
      });

      it("rejects a defineChannels argument that is not an object literal", () => {
         for (const code of [
            "export default defineChannels(channels);",
            "export default defineChannels();",
         ]) {
            expect(parseError(code)).toContain("defineChannels accepts one object literal");
         }
      });

      it("rejects the removed signature and listeners options as unsupported", () => {
         expect(parseError(wrap("chan: invoke({ signature: type as () => void })"))).toContain(
            "option 'signature' is not supported by 'invoke'",
         );
         expect(parseError(wrap('chan: send<() => void>({ listeners: ["onChan"] })'))).toContain(
            "option 'listeners' is not supported by 'send'",
         );
      });

      it("ignores leftover Channel expressions", () => {
         const out = parseMap('Channel("userChannel").RendererToMain.Broadcast({});');
         expect(out).toStrictEqual({ channelSpecs: [], channelMapExport: null });
      });
   });
});
