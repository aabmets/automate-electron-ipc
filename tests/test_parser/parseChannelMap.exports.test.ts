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

import { parseError, parseMap } from "@testutils/channel-map-utils.js";
import { describe, expect, it } from "vitest";

describe("parseChannelMapModule", () => {
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

      // T97: `export = channels` is not an export that the generated files can import.
      it("rejects a map that is exported with 'export ='", () => {
         const msg = parseError(
            "const channels = defineChannels({ chan: invoke<() => void>() });\nexport = channels;",
         );
         expect(msg).toContain("schema.ts");
         expect(msg).toContain("'export =' is not supported");
         expect(msg).toContain("export default defineChannels");
         expect(parseError("export = defineChannels({});")).toContain(
            "'export =' is not supported",
         );
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
});
