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

describe("parseChannelMapModule", () => {
   describe("config", () => {
      it("reads the trigger of emit in both forms", () => {
         const generic = parseOne('chan: emit<(n: number) => void>({ trigger: "focus" })');
         const alternative = parseOne('chan: emit({ trigger: "focus" }) as (n: number) => void');
         expect(generic.trigger).toBe("focus");
         expect(alternative.trigger).toBe("focus");
      });

      it("accepts a trigger with quotes of either kind", () => {
         expect(parseOne("chan: emit<() => void>({ trigger: 'ready-to-show' })").trigger).toBe(
            "ready-to-show",
         );
      });

      it("does not set a trigger when none is given", () => {
         expect(parseOne("chan: emit<() => void>()")).not.toHaveProperty("trigger");
      });

      it("reads allowedOrigins of invoke and send in both forms", () => {
         const generic = parseOne(
            "chan: invoke<() => Promise<void>>({ allowedOrigins: [\"app://.\", 'http://localhost:5173'] })",
         );
         const alternative = parseOne('chan: send({ allowedOrigins: ["app://."] }) as () => void');
         expect(generic.allowedOrigins).toStrictEqual(["app://.", "http://localhost:5173"]);
         expect(alternative.allowedOrigins).toStrictEqual(["app://."]);
      });

      it("reads allowedOrigins through parentheses and an empty list", () => {
         const spec = parseOne("chan: send<() => void>({ allowedOrigins: (['app://.']) })");
         expect(spec.allowedOrigins).toStrictEqual(["app://."]);
         expect(
            parseOne("chan: send<() => void>({ allowedOrigins: [] })").allowedOrigins,
         ).toStrictEqual([]);
      });

      it("does not set allowedOrigins when none are given", () => {
         expect(parseOne("chan: invoke<() => void>()")).not.toHaveProperty("allowedOrigins");
      });

      const wrap = (entry: string) => `export default defineChannels({ ${entry} });`;

      it("rejects allowedOrigins that are not an array of string literals", () => {
         for (const value of [
            '"app://."',
            "origins",
            "[origin]",
            '[...origins, "app://."]',
            '["app://.", , "b"]',
            "[`app://.`]",
            "[1]",
         ]) {
            const msg = parseError(wrap(`chan: send<() => void>({ allowedOrigins: ${value} })`));
            expect(msg).toContain("channel 'chan'");
            expect(msg).toContain("option 'allowedOrigins' must be an array of string literals");
         }
      });

      describe("validate", () => {
         const imports = (extra: string) => `${IMPORT}\n${extra}`;
         const specOf = (entry: string, extra: string) => {
            const { channelSpecs } = parseMap(
               `export default defineChannels({ ${entry} });`,
               imports(extra),
            );
            return channelSpecs[0];
         };

         it("resolves a named import, in both forms", () => {
            const extra = 'import { idArgs } from "./validators";';
            const generic = specOf(
               "chan: invoke<(id: number) => void>({ validate: idArgs })",
               extra,
            );
            const alternative = specOf(
               "chan: send({ validate: idArgs }) as (id: number) => void",
               extra,
            );
            const expected = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
            expect(generic.validate).toStrictEqual(expected);
            expect(alternative.validate).toStrictEqual(expected);
         });

         it("resolves an aliased and a default import to the exported name", () => {
            const extra = 'import fallback, { idArgs as ids } from "../shared/validators.js";';
            const aliased = specOf("chan: invoke<(id: number) => void>({ validate: ids })", extra);
            const fallback = specOf("chan: invoke<() => void>({ validate: (fallback) })", extra);
            expect(aliased.validate).toStrictEqual({
               name: "ids",
               exported: "idArgs",
               fromPath: "../shared/validators.js",
            });
            expect(fallback.validate).toStrictEqual({
               name: "fallback",
               exported: "default",
               fromPath: "../shared/validators.js",
            });
         });

         it("resolves a package import", () => {
            const extra = 'import { schema } from "@scope/validators";';
            const spec = specOf("chan: invoke<() => void>({ validate: schema })", extra);
            expect(spec.validate?.fromPath).toBe("@scope/validators");
         });

         it("does not set validate when none is given", () => {
            expect(parseOne("chan: invoke<() => void>()")).not.toHaveProperty("validate");
         });

         it("combines validate with allowedOrigins", () => {
            const extra = 'import { idArgs } from "./v";';
            const spec = specOf(
               'chan: invoke<(id: number) => void>({ allowedOrigins: ["app://."], validate: idArgs })',
               extra,
            );
            expect(spec.allowedOrigins).toStrictEqual(["app://."]);
            expect(spec.validate?.name).toBe("idArgs");
         });

         const failing = (value: string, extra: string) =>
            parseError(
               `export default defineChannels({ chan: invoke<() => void>({ validate: ${value} }) });`,
               imports(extra),
            );

         it("rejects what is not an identifier", () => {
            const extra = 'import { schemas } from "./v";';
            for (const value of ["schemas.idArgs", "schemas()", "[schemas]", '"schemas"', "null"]) {
               const msg = failing(value, extra);
               expect(msg).toContain("channel 'chan'");
               expect(msg).toContain("must be an identifier which the schema file imports");
            }
         });

         it("rejects a name which the schema file declares itself or does not know", () => {
            const local = failing("local", "const local = { '~standard': {} };");
            expect(local).toContain("'local', which is not imported in the schema file");
            expect(failing("missing", "")).toContain("'missing', which is not imported");
         });

         it("rejects type-only imports, since they have no value at runtime", () => {
            for (const extra of [
               'import type { idArgs } from "./v";',
               'import { type idArgs } from "./v";',
               'import type idArgs from "./v";',
            ]) {
               expect(failing("idArgs", extra)).toContain("which is a type-only import");
            }
         });

         it("rejects a namespace import", () => {
            expect(failing("v", 'import * as v from "./v";')).toContain("a namespace import");
         });

         it("rejects validate on emit, ask and the port verbs", () => {
            for (const verb of ["emit", "ask", "port", "mainPort"]) {
               const msg = parseError(
                  `export default defineChannels({ chan: ${verb}<() => void>({ validate: idArgs }) });`,
                  imports('import { idArgs } from "./v";'),
               );
               expect(msg).toContain(`option 'validate' is not supported by '${verb}'`);
            }
         });
      });

      it("rejects allowedOrigins on emit, ask and the port verbs", () => {
         for (const verb of ["emit", "ask", "port", "mainPort"]) {
            const msg = parseError(
               wrap(`chan: ${verb}<() => void>({ allowedOrigins: ["app://."] })`),
            );
            expect(msg).toContain(`option 'allowedOrigins' is not supported by '${verb}'`);
         }
      });

      it("rejects a trigger that is not a string literal", () => {
         const msg = parseError(
            "export default defineChannels({ chan: emit<() => void>({ trigger: x }) });",
         );
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain("must be a string literal");
      });
   });
});
