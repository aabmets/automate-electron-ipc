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

import { collectScopes, filterByScope, isInScope, scopedFilePath } from "@src/scopes.js";
import { buildFileSpecs } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

/** The channels of a schema file, with the scopes of each. */
function build(...channels: [name: string, scopes?: string[]][]): t.ParsedFileSpecs[] {
   const [file] = buildFileSpecs(
      ...channels.map(([name]) => ({
         name,
         kind: "Unicast" as const,
         direction: "RendererToMain" as const,
      })),
   );
   file.specs.channelSpecArray.forEach((spec, index) => {
      const channelScopes = channels[index][1];
      if (channelScopes) {
         spec.scopes = channelScopes;
      }
   });
   return [file];
}

const names = (pfsArray: t.ParsedFileSpecs[]) =>
   pfsArray.flatMap((pfs) => pfs.specs.channelSpecArray.map((spec) => spec.name));

describe("isInScope", () => {
   const [{ specs }] = build(
      ["open"],
      ["settingsOnly", ["settings"]],
      ["both", ["settings", "editor"]],
   );
   const [open, settingsOnly, both] = specs.channelSpecArray;

   it("has a channel without scopes in every scope, and in the surface of no scope", () => {
      expect(
         [null, "settings", "editor", "other"].map((scope) => isInScope(open, scope)),
      ).toStrictEqual([true, true, true, true]);
   });

   it("has a channel with scopes in the scopes that it lists only", () => {
      expect(isInScope(settingsOnly, "settings")).toBe(true);
      expect(isInScope(settingsOnly, "editor")).toBe(false);
      expect(isInScope(both, "settings")).toBe(true);
      expect(isInScope(both, "editor")).toBe(true);
      expect(isInScope(both, "other")).toBe(false);
   });

   it("leaves a channel with scopes out of the surface of no scope", () => {
      expect(isInScope(settingsOnly, null)).toBe(false);
      expect(isInScope(both, null)).toBe(false);
   });

   it("does not take a name of Object.prototype for a scope", () => {
      expect(isInScope(settingsOnly, "constructor")).toBe(false);
   });
});

describe("collectScopes", () => {
   it("lists every scope once, in code unit order", () => {
      const pfsArray = build(["a", ["settings", "editor"]], ["b", ["editor", "Zed"]], ["c"]);
      expect(collectScopes(pfsArray)).toStrictEqual(["Zed", "editor", "settings"]);
   });

   it("collects them across schema files", () => {
      const pfsArray = [...build(["a", ["one"]]), ...build(["b", ["two"]])];
      expect(collectScopes(pfsArray)).toStrictEqual(["one", "two"]);
   });

   it("lists none for a schema without scopes, and for no schema", () => {
      expect(collectScopes(build(["a"], ["b"]))).toStrictEqual([]);
      expect(collectScopes([])).toStrictEqual([]);
   });
});

describe("filterByScope", () => {
   const pfsArray = build(
      ["open"],
      ["settingsOnly", ["settings"]],
      ["both", ["settings", "editor"]],
   );

   it("keeps the channels without scopes for the surface of no scope", () => {
      expect(names(filterByScope(pfsArray, null))).toStrictEqual(["open"]);
   });

   it("keeps the channels without scopes and the ones of the scope, in order", () => {
      expect(names(filterByScope(pfsArray, "settings"))).toStrictEqual([
         "open",
         "settingsOnly",
         "both",
      ]);
      expect(names(filterByScope(pfsArray, "editor"))).toStrictEqual(["open", "both"]);
   });

   it("keeps only the channels without scopes for a scope that no channel lists", () => {
      expect(names(filterByScope(pfsArray, "unknown"))).toStrictEqual(["open"]);
   });

   it("drops a schema file which has no channel left", () => {
      const scoped = [...build(["a", ["one"]]), ...build(["b"])];
      const surface = filterByScope(scoped, null);

      expect(surface).toHaveLength(1);
      expect(names(surface)).toStrictEqual(["b"]);
      expect(filterByScope(build(["a", ["one"]]), null)).toStrictEqual([]);
   });

   it("does not change the schema files that it is given", () => {
      const before = names(pfsArray);

      filterByScope(pfsArray, null);

      expect(names(pfsArray)).toStrictEqual(before);
   });

   it("keeps the other fields of a schema file", () => {
      const [file] = filterByScope(pfsArray, "editor");

      expect(file.fullPath).toBe(pfsArray[0].fullPath);
      expect(file.relativePath).toBe(pfsArray[0].relativePath);
      expect(file.specs.typeSpecArray).toBe(pfsArray[0].specs.typeSpecArray);
   });
});

describe("scopedFilePath", () => {
   it("puts the scope before the extension", () => {
      expect(scopedFilePath("/p/ipc/preload.ts", "settings")).toBe("/p/ipc/preload.settings.ts");
      expect(scopedFilePath("/p/ipc/window.d.ts", "plugin-host")).toBe(
         "/p/ipc/window.plugin-host.d.ts",
      );
   });

   it("keeps the path of the surface of no scope", () => {
      expect(scopedFilePath("/p/ipc/preload.ts", null)).toBe("/p/ipc/preload.ts");
   });

   it("keeps a path that has no extension of a TypeScript file", () => {
      expect(scopedFilePath("/p/ipc/preload", "settings")).toBe("/p/ipc/preload");
   });

   it("changes the extension of the file name only, not a directory with dots", () => {
      expect(scopedFilePath("/p/a.ts/ipc/preload.ts", "x")).toBe("/p/a.ts/ipc/preload.x.ts");
   });
});
