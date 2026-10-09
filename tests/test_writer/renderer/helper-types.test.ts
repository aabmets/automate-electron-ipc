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

import { filterByScope } from "@src/scopes.js";
import { renderSpecs } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestHelperTypesWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt, parseTestSignature } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

/** A schema file with one channel per name, exported as the given channel map. */
function schemaFile(
   file: string,
   names: string[],
   channelMapExport: t.ChannelMapExport | null,
   typeNames: string[] = [],
   direction: t.ChannelDirection = "RendererToMain",
): t.ParsedFileSpecs {
   return {
      fullPath: `/project/${file}.ts`,
      relativePath: `${file}.ts`,
      specs: {
         channelMapExport,
         importSpecArray: [],
         typeSpecArray: typeNames.map((name) => ({
            name,
            kind: "interface" as t.TypeKind,
            generics: null,
            isExported: true,
         })),
         channelSpecArray: names.map((name, index) => ({
            name,
            kind: "Unicast",
            direction,
            signature: parseTestSignature(
               `() => Promise<${typeNames[index % Math.max(typeNames.length, 1)] ?? "string"}>`,
            ),
         })),
      },
   };
}

describe("HelperTypesWriter, the helper types", () => {
   mockGetTargetFilePath(VitestHelperTypesWriter);

   const render = (
      pfsArray: t.ParsedFileSpecs[],
      config: Partial<t.IPCResolvedConfig> = {},
      scope: string | null = null,
   ) => renderSpecs(VitestHelperTypesWriter, pfsArray, config, scope);

   it("declares the names of the channels as a union, in name order", () => {
      const output = render(buildFileSpecs(getIt, { ...getIt, name: "alpha" }));

      expect(output).toContain(
         "/** The name of a channel of the API. */\nexport type ChannelName = 'alpha' | 'getIt';",
      );
   });

   it("reads the signatures from the type of the default export of the schema file", () => {
      const output = render(buildFileSpecs(getIt));

      expect(output).toContain('import type { ChannelDef } from "automate-electron-ipc";');
      expect(output).toMatch(/^import type ChannelMap from ".*\/schema";$/m);
      expect(output).toContain("type ChannelMaps = typeof ChannelMap;");
      expect(output).toContain(
         "export type ChannelArgs<N extends ChannelName> = Parameters<SignatureOf<ChannelMaps[N]>>;",
      );
      expect(output).toContain(
         "export type ChannelReturn<N extends ChannelName> =\n   ChunkOf<Awaited<ReturnType<SignatureOf<ChannelMaps[N]>>>>;",
      );
   });

   it("takes the signature from a ChannelDef, or else from the function type itself", () => {
      const output = render(buildFileSpecs(getIt));

      expect(output).toContain(
         "type SignatureOf<T> = T extends ChannelDef<infer S extends (...args: any[]) => any, any>\n   ? S\n   : T extends (...args: any[]) => any\n   ? T\n   : never;",
      );
      expect(output).toContain("type ChunkOf<R> = R extends AsyncIterable<infer C> ? C : R;");
   });

   it("imports a named channel map under a local name", () => {
      const output = render([schemaFile("schema", ["getIt"], { kind: "named", name: "channels" })]);

      expect(output).toMatch(/^import type \{ channels as ChannelMap \} from ".*\/schema";$/m);
      expect(output).toContain("type ChannelMaps = typeof ChannelMap;");
   });

   it("joins the maps of all schema files, and lists the channels of all of them", () => {
      const output = render([
         schemaFile("a", ["zed"], { kind: "default" }),
         schemaFile("b", ["beta", "alpha"], { kind: "named", name: "channels" }),
      ]);

      expect(output).toMatch(/^import type ChannelMap from ".*\/a";$/m);
      expect(output).toMatch(/^import type \{ channels as ChannelMap_2 \} from ".*\/b";$/m);
      expect(output).toContain("type ChannelMaps = typeof ChannelMap & typeof ChannelMap_2;");
      expect(output).toContain("export type ChannelName = 'alpha' | 'beta' | 'zed';");
   });

   it("imports the map once, however many of its channels the page has", () => {
      const output = render([schemaFile("schema", ["a", "b", "c"], { kind: "default" })]);

      expect(output.match(/^import type ChannelMap from/gm)).toHaveLength(1);
   });

   it("leaves out the channels of the page which are not its own, and their files", () => {
      const output = render([
         schemaFile("page", ["getIt"], { kind: "default" }),
         schemaFile("utility", ["tick"], { kind: "named", name: "u" }, [], "MainToUtility"),
         schemaFile("pushed", ["push"], { kind: "named", name: "p" }, [], "UtilityToMain"),
      ]);

      expect(output).toContain("export type ChannelName = 'getIt';");
      expect(output).not.toContain("/utility");
      expect(output).not.toContain("/pushed");
      expect(output).toContain("type ChannelMaps = typeof ChannelMap;");
   });

   it("names no channel of a file which exports no channel map, since it has none to read", () => {
      const output = render([
         schemaFile("lost", ["lost"], null),
         schemaFile("found", ["found"], { kind: "default" }),
      ]);

      expect(output).toContain("export type ChannelName = 'found';");
      expect(output).toContain("type ChannelMaps = typeof ChannelMap;");
   });

   it("declares the names of the channels of the surface of a scope only", () => {
      const channels = buildFileSpecs(getIt, {
         name: "sendIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         scopes: ["settings"],
      });

      expect(render(filterByScope(channels, null))).toContain("export type ChannelName = 'getIt';");
      expect(render(filterByScope(channels, "settings"), {}, "settings")).toContain(
         "export type ChannelName = 'getIt' | 'sendIt';",
      );
   });

   it("is empty for a page without channels, and imports nothing for it", () => {
      const output = render([]);

      expect(output).toContain("export type ChannelName = never;");
      expect(output).toContain(
         "export type ChannelArgs<N extends ChannelName> = N extends ChannelName ? never : never;",
      );
      expect(output).toContain(
         "export type ChannelReturn<N extends ChannelName> = N extends ChannelName ? never : never;",
      );
      expect(output).not.toContain("import");
      expect(output).not.toContain("ChannelMaps");
   });

   it("spells the import of the schema file as NodeNext needs it", () => {
      const output = render(buildFileSpecs(getIt), { projectUsesNodeNext: true });

      expect(output).toMatch(/^import type ChannelMap from ".*\/schema\.js";$/m);
   });

   it("puts the import of the map in the sorted list of the imports", () => {
      const output = render([schemaFile("schema", ["getUser"], { kind: "default" }, ["User"])]);
      const imports = output.split("\n").filter((line) => line.startsWith("import "));

      expect(imports).toStrictEqual([
         expect.stringMatching(/^import type ChannelMap from ".*\/schema";$/),
         'import type { ChannelDef } from "automate-electron-ipc";',
         expect.stringMatching(/^import type \{ User \} from ".*\/schema";$/),
      ]);
   });

   it("imports a schema type under another name when it has the name of a helper type", () => {
      const output = render([
         schemaFile("schema", ["a", "b", "c"], { kind: "default" }, [
            "ChannelName",
            "ChannelMap",
            "ChannelDef",
         ]),
      ]);

      expect(output).toMatch(
         /^import type \{ ChannelName as ChannelName_2 \} from ".*\/schema";$/m,
      );
      expect(output).toMatch(/^import type \{ ChannelDef as ChannelDef_2 \} from ".*\/schema";$/m);
      expect(output).toMatch(/^import type \{ ChannelMap \} from ".*\/schema";$/m);
      expect(output).toMatch(/^import type ChannelMap_2 from ".*\/schema";$/m);
      expect(output).toContain("type ChannelMaps = typeof ChannelMap_2;");
      expect(output).toContain("export type ChannelName = 'a' | 'b' | 'c';");
   });

   it("declares no global, so a file of the main process can import it", () => {
      const output = render(buildFileSpecs(getIt));

      expect(output).not.toContain("declare global");
      expect(output).toContain("export interface IpcApi {");
      expect(output.endsWith("\n")).toBe(true);
   });
});
