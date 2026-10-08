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

const IMPORT = 'import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";';

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
         ["port", "Port", "RendererToRenderer"],
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

      it("rejects allowedOrigins on emit and port", () => {
         for (const verb of ["emit", "port"]) {
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

      it("rejects more than one type argument", () => {
         const msg = parseError(wrap("chan: invoke<() => void, string>()"));
         expect(msg).toContain("exactly one type argument");
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
         const msg = parseError(wrap("chan: stream<() => void>()"));
         expect(msg).toContain("channel 'chan'");
         expect(msg).toContain("unknown verb 'stream'");
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
         for (const verb of ["invoke", "send", "port"]) {
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
