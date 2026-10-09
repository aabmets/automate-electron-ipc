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

import parser from "@src/parser.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

const IMPORT =
   'import { defineChannels, invoke, send, emit, ask, stream, port, mainPort, callUtility, notifyUtility, callMain, notifyMain, invokeUtility, streamUtility } from "automate-electron-ipc";';

function parseMap(code: string, imports = IMPORT) {
   const { module, src } = parser.parseModule(`${imports}\n${code}`);
   return parser.parseChannelMapModule(module, src, "schema.ts");
}

function parseOne(entry: string): Partial<t.ChannelSpec> {
   const { channelSpecs } = parseMap(`export default defineChannels({ ${entry} });`);
   if (channelSpecs.length !== 1) {
      throw new Error(`Expected one channel, got ${channelSpecs.length}`);
   }
   return channelSpecs[0];
}

function parseError(code: string, imports = IMPORT): string {
   try {
      parseMap(code, imports);
   } catch (err) {
      return (err as Error).message;
   }
   throw new Error("Expected the parser to throw");
}

describe("parseChannelMapModule", () => {
   describe("verbs", () => {
      const verbs = [
         ["invoke", "Unicast", "RendererToMain"],
         ["send", "Broadcast", "RendererToMain"],
         ["emit", "Broadcast", "MainToRenderer"],
         ["ask", "Unicast", "MainToRenderer"],
         ["port", "Port", "RendererToRenderer"],
         ["mainPort", "Port", "MainToRenderer"],
         ["callUtility", "Unicast", "MainToUtility"],
         ["notifyUtility", "Broadcast", "MainToUtility"],
         ["callMain", "Unicast", "UtilityToMain"],
         ["notifyMain", "Broadcast", "UtilityToMain"],
         ["invokeUtility", "Unicast", "RendererToUtility"],
      ] as const;

      for (const [verb, kind, direction] of verbs) {
         describe(verb, () => {
            const expected = { name: "chan", kind, direction };

            it("parses the generic form", () => {
               const spec = parseOne(`chan: ${verb}<(a: string) => void>()`);
               expect(spec).toMatchObject(expected);
               expect(spec.signature?.definition).toBe("(a: string) => void");
            });

            it("parses the generic form with an empty config", () => {
               const spec = parseOne(`chan: ${verb}<(a: string) => void>({})`);
               expect(spec).toMatchObject(expected);
            });

            it("parses the as form", () => {
               const spec = parseOne(`chan: ${verb}() as (a: string) => void`);
               expect(spec).toMatchObject(expected);
               expect(spec.signature?.definition).toBe("(a: string) => void");
            });

            it("parses the as form with an empty config", () => {
               const spec = parseOne(`chan: ${verb}({}) as (a: string) => void`);
               expect(spec).toMatchObject(expected);
            });

            it("gives both forms the same spec", () => {
               const generic = parseOne(`chan: ${verb}<(a: Foo, b?: number) => void>()`);
               const alternative = parseOne(`chan: ${verb}() as (a: Foo, b?: number) => void`);
               expect(alternative).toStrictEqual(generic);
            });
         });
      }
   });

   describe("this parameters", () => {
      // Regression for T69: the wrappers declared `this` as an ordinary parameter (TS2680).
      it("rejects a this parameter in the generic and the as form", () => {
         const message =
            "Schema file 'schema.ts': channel 'chan': " +
            "a 'this' parameter is not supported, since IPC does not transfer 'this'.";
         expect(
            parseError(
               "export default defineChannels({ chan: send<(this: Foo, a: string) => void>() });",
            ),
         ).toBe(message);
         expect(
            parseError("export default defineChannels({ chan: send() as (this: Foo) => void });"),
         ).toBe(message);
      });

      it("accepts a parameter that is merely called thisArg", () => {
         const spec = parseOne("chan: send<(thisArg: Foo) => void>()");
         expect(spec.signature?.params.map((param) => param.name)).toStrictEqual(["thisArg"]);
      });
   });

   describe("signatures", () => {
      it("parses params, return type and custom types", () => {
         const spec = parseOne("chan: invoke<(a: string, b: Foo<Bar>[]) => Baz>()");
         expect(spec.signature).toMatchObject({
            definition: "(a: string, b: Foo<Bar>[]) => Baz",
            paramsStart: 1,
            params: [
               { name: "a", type: "string", rest: false, optional: false },
               { name: "b", type: "Foo<Bar>[]", rest: false, optional: false },
            ],
            returnType: "Baz",
            customTypes: ["Foo", "Bar", "Baz"],
            async: false,
         });
      });

      it("detects an async return type", () => {
         const spec = parseOne("chan: invoke<(id: number) => Promise<User>>()");
         expect(spec.signature).toMatchObject({
            returnType: "Promise<User>",
            customTypes: ["User"],
            async: true,
         });
      });

      it("parses a signature without params", () => {
         const spec = parseOne("chan: invoke<() => number>()");
         expect(spec.signature).toMatchObject({ params: [], returnType: "number", async: false });
      });

      it("parses optional and rest params", () => {
         const spec = parseOne("chan: send<(a: string, b?: number, ...rest: Foo[]) => void>()");
         expect(spec.signature?.params).toMatchObject([
            { name: "a", type: "string", rest: false, optional: false },
            { name: "b", type: "number", rest: false, optional: true },
            { name: "rest", type: "Foo[]", rest: true, optional: false },
         ]);
      });

      it("parses destructured params", () => {
         const spec = parseOne("chan: send<({ abc }: Foo, [x, y]: Bar) => void>()");
         expect(spec.signature?.params).toMatchObject([
            { name: "{ abc }", type: "Foo", rest: false, optional: false },
            { name: "[x, y]", type: "Bar", rest: false, optional: false },
         ]);
      });

      it("parses the same signature from the as form", () => {
         const spec = parseOne("chan: invoke() as (a?: string, ...rest: Foo[]) => Promise<Bar>");
         expect(spec.signature).toMatchObject({
            params: [
               { name: "a", type: "string", rest: false, optional: true },
               { name: "rest", type: "Foo[]", rest: true, optional: false },
            ],
            returnType: "Promise<Bar>",
            customTypes: ["Foo", "Bar"],
            async: true,
         });
      });

      it("unwraps parentheses around the as expression and its signature", () => {
         for (const entry of [
            "chan: (invoke() as (a: string) => void)",
            "chan: (invoke()) as (a: string) => void",
            "chan: invoke() as ((a: string) => void)",
            "chan: (invoke<(a: string) => void>())",
            "chan: invoke<((a: string) => void)>()",
         ]) {
            const spec = parseOne(entry);
            expect(spec.signature?.definition).toBe("(a: string) => void");
         }
      });
   });

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

   describe("imports", () => {
      it("resolves aliased imports", () => {
         const imports =
            'import { defineChannels as dc, invoke as call, emit as push } from "automate-electron-ipc";';
         const { channelSpecs } = parseMap(
            `export default dc({ a: call<() => void>(), b: push() as () => void });`,
            imports,
         );
         expect(channelSpecs.map((s) => s.kind)).toStrictEqual(["Unicast", "Broadcast"]);
         expect(channelSpecs.map((s) => s.direction)).toStrictEqual([
            "RendererToMain",
            "MainToRenderer",
         ]);
      });

      it("resolves namespace imports", () => {
         const imports = 'import * as ipc from "automate-electron-ipc";';
         const { channelSpecs } = parseMap(
            `export default ipc.defineChannels({ chan: ipc.port<() => void>() });`,
            imports,
         );
         expect(channelSpecs[0]).toMatchObject({ name: "chan", kind: "Port" });
      });

      it("does not treat same-named functions from other modules as verbs", () => {
         const imports = 'import { defineChannels, invoke } from "other-lib";';
         const { channelSpecs, channelMapExport } = parseMap(
            "export default defineChannels({ chan: invoke<() => void>() });",
            imports,
         );
         expect(channelSpecs).toStrictEqual([]);
         expect(channelMapExport).toBeNull();
      });

      it("reports a verb that is not imported from the library as unknown", () => {
         const msg = parseError("export default defineChannels({ chan: other<() => void>() });");
         expect(msg).toContain("unknown verb 'other'");
      });

      it("reports a local alias of the wrong verb as unknown", () => {
         const imports = 'import { defineChannels, invoke as call } from "automate-electron-ipc";';
         const msg = parseError(
            "export default defineChannels({ chan: invoke<() => void>() });",
            imports,
         );
         expect(msg).toContain("unknown verb 'invoke'");
      });
   });

   describe("exports", () => {
      it("records a default export", () => {
         const out = parseMap("export default defineChannels({ chan: invoke<() => void>() });");
         expect(out.channelMapExport).toStrictEqual({ kind: "default" });
      });

      it("records a named export", () => {
         const out = parseMap(
            "export const channels = defineChannels({ chan: send<() => void>() });",
         );
         expect(out.channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
         expect(out.channelSpecs).toHaveLength(1);
      });

      it("accepts a const that is exported later by default", () => {
         const out = parseMap(
            "const channels = defineChannels({ chan: send<() => void>() });\nexport default channels;",
         );
         expect(out.channelMapExport).toStrictEqual({ kind: "default" });
         expect(out.channelSpecs).toHaveLength(1);
      });

      it("accepts a const that is exported later by name or alias", () => {
         const named = parseMap(
            "const channels = defineChannels({ chan: send<() => void>() });\nexport { channels };",
         );
         expect(named.channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
         const aliased = parseMap(
            "const channels = defineChannels({ chan: send<() => void>() });\nexport { channels as ipc };",
         );
         expect(aliased.channelMapExport).toStrictEqual({ kind: "named", name: "ipc" });
      });

      // Regression for T58: only parentheses were unwrapped, so a wrapped call was reported
      // as not exported.
      const wrappers = ["satisfies Foo", "as Foo", "as const", "as unknown as Foo", "!"];
      for (const wrapper of wrappers) {
         it(`accepts a default export followed by '${wrapper}'`, () => {
            const out = parseMap(
               `type Foo = unknown;\nexport default defineChannels({ chan: send<() => void>() }) ${wrapper};`,
            );
            expect(out.channelMapExport).toStrictEqual({ kind: "default" });
            expect(out.channelSpecs).toHaveLength(1);
         });

         it(`accepts a named export followed by '${wrapper}'`, () => {
            const out = parseMap(
               `type Foo = unknown;\nexport const channels = defineChannels({ chan: send<() => void>() }) ${wrapper};`,
            );
            expect(out.channelMapExport).toStrictEqual({ kind: "named", name: "channels" });
            expect(out.channelSpecs).toHaveLength(1);
         });

         it(`accepts a const that is wrapped with '${wrapper}' and exported later`, () => {
            const out = parseMap(
               `type Foo = unknown;\nconst channels = defineChannels({ chan: send<() => void>() }) ${wrapper};\nexport default channels;`,
            );
            expect(out.channelMapExport).toStrictEqual({ kind: "default" });
            expect(out.channelSpecs).toHaveLength(1);
         });
      }

      it("accepts nested parentheses, assertions and a wrapped exported identifier", () => {
         const call = "defineChannels({ chan: send<() => void>() })";
         const nested = parseMap(`export default ((${call} satisfies object) as object)!;`);
         expect(nested.channelMapExport).toStrictEqual({ kind: "default" });
         const angle = parseMap(`export default <object>${call};`);
         expect(angle.channelSpecs).toHaveLength(1);
         const local = parseMap(`const c = ${call};\nexport default (c as object);`);
         expect(local.channelMapExport).toStrictEqual({ kind: "default" });
      });

      it("still rejects a wrapped call that is not exported", () => {
         const msg = parseError("const c = defineChannels({}) satisfies object;");
         expect(msg).toContain("must be exported");
      });

      it("parses an empty map", () => {
         const out = parseMap("export default defineChannels({});");
         expect(out.channelSpecs).toStrictEqual([]);
         expect(out.channelMapExport).toStrictEqual({ kind: "default" });
      });

      it("finds no channels in a file without defineChannels", () => {
         const out = parseMap("export type Foo = string;");
         expect(out).toStrictEqual({ channelSpecs: [], channelMapExport: null });
      });

      it("rejects a defineChannels call that is not assigned", () => {
         const msg = parseError("defineChannels({ chan: invoke<() => void>() });");
         expect(msg).toContain("schema.ts");
         expect(msg).toContain("must be exported");
      });

      it("rejects a non-exported const", () => {
         const msg = parseError("const channels = defineChannels({ chan: invoke<() => void>() });");
         expect(msg).toContain("must be exported");
      });

      it("rejects a non-exported let and a call inside a function", () => {
         expect(parseError("let c = defineChannels({});")).toContain("must be exported");
         expect(parseError("export function f() { return defineChannels({}); }")).toContain(
            "must be exported",
         );
      });

      it("rejects more than one defineChannels call", () => {
         const msg = parseError(
            "export const a = defineChannels({});\nexport const b = defineChannels({});",
         );
         expect(msg).toContain("schema.ts");
         expect(msg).toContain("only one defineChannels call");
      });
   });

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

describe("utility channels", () => {
   const verbs = ["callUtility", "notifyUtility", "callMain", "notifyMain"];

   it.each(verbs)("rejects every option of %s, since it has none", (verb) => {
      expect(
         parseError(`export default defineChannels({ a: ${verb}<() => void>({ timeoutMs: 5 }) });`),
      ).toBe(
         `Schema file 'schema.ts': channel 'a': option 'timeoutMs' is not supported by '${verb}'.`,
      );
      expect(
         parseError(`export default defineChannels({ a: ${verb}<() => void>({ validate: v }) });`),
      ).toContain("option 'validate' is not supported");
   });

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

   it.each(verbs)("rejects every option of %s, since it has none", (verb) => {
      for (const option of ["timeoutMs: 5", "validate: v", 'allowedOrigins: ["app://."]']) {
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
