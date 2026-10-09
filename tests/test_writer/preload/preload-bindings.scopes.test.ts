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
import { PreloadBindingsWriter } from "@src/writer/preload/preload-bindings.js";
import { renderSpecs } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestPreloadBindingsWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mockGetTargetFilePath(VitestPreloadBindingsWriter);

   describe("scopes", () => {
      const config = {
         codeIndent: 3,
         preloadBindingsFilePath: "/p/ipc/preload.ts",
      } as t.IPCResolvedConfig;
      const targetOf = (scope: string | null) =>
         (
            new PreloadBindingsWriter(config, [], scope) as unknown as {
               getTargetFilePath(): string;
            }
         ).getTargetFilePath();
      const channels = buildFileSpecs(getIt, {
         name: "sendIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         scopes: ["settings"],
      });
      const render = (pfsArray: t.ParsedFileSpecs[], scope: string | null) =>
         renderSpecs(VitestPreloadBindingsWriter, pfsArray, {}, scope);

      it("writes the file of the surface of no scope to the usual path", () => {
         expect(targetOf(null)).toBe("/p/ipc/preload.ts");
      });

      it("writes the file of a scope next to it, named after the scope", () => {
         expect(targetOf("settings")).toBe("/p/ipc/preload.settings.ts");
         expect(targetOf("plugin-host")).toBe("/p/ipc/preload.plugin-host.ts");
      });

      it("writes the code of the channels it is given, whatever the scope is", async () => {
         const surface = filterByScope(channels, "settings");

         expect(await render(surface, "settings")).toStrictEqual(await render(surface, null));
         expect(await render(surface, "settings")).toContain("   sendIt: {");
      });

      it("writes only the channels of the surface of the scope", async () => {
         const none = await render(filterByScope(channels, null), null);
         const settings = await render(filterByScope(channels, "settings"), "settings");
         const editor = await render(filterByScope(channels, "editor"), "editor");

         expect(none).toContain("   getIt: {");
         expect(none).not.toContain("sendIt");
         expect(settings).toContain("   getIt: {");
         expect(settings).toContain("   sendIt: {");
         expect(editor).toContain("   getIt: {");
         expect(editor).not.toContain("sendIt");
      });

      it("writes the empty API for a scope whose surface has no channel", async () => {
         const output = await render([], "empty");
         expect(output).toContain("export const api = {};");
         expect(output).toContain("expose();");
      });
   });

   describe("getPathForFile", () => {
      const channels = buildFileSpecs(getIt, {
         name: "zed",
         kind: "Broadcast",
         direction: "RendererToMain",
      });
      const render = (pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig>) =>
         renderSpecs(VitestPreloadBindingsWriter, pfsArray, config);
      const HELPER = "getPathForFile: (file: File): string => webUtils.getPathForFile(file),";

      it("adds nothing when the config says nothing, or says false", async () => {
         const output = await render(channels, {});
         expect(output).not.toContain("getPathForFile");
         expect(output).not.toContain("webUtils");
         expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
         expect(await render(channels, { getPathForFile: false })).toBe(output);
      });

      it("imports webUtils, and puts the helper among the members, in name order", async () => {
         const output = await render(channels, { getPathForFile: true });
         expect(output).toContain(
            'import { contextBridge, ipcRenderer, webUtils } from "electron";',
         );
         const exposed = output.slice(output.indexOf("export const api"));
         expect([...exposed.matchAll(/^ {3}(\w+): /gm)].map((match) => match[1])).toStrictEqual([
            "getIt",
            "getPathForFile",
            "zed",
         ]);
         expect(output).toContain(`\n   ${HELPER}\n`);
         expect(output.match(/webUtils\.getPathForFile/g)).toHaveLength(1);
      });

      it("adds the helper to the empty API as well", async () => {
         expect(await render([], { getPathForFile: true, autoExpose: false })).toBe(
            [
               'import { contextBridge, webUtils } from "electron";',
               "",
               "export const api = {",
               `   ${HELPER}`,
               "};",
               "",
               "export function expose(key = 'ipc'): void {",
               "   contextBridge.exposeInMainWorld(key, api);",
               "}",
            ].join("\n"),
         );
      });

      it("adds the helper to the empty API of a schema that has only utility channels", async () => {
         const utilityOnly = buildFileSpecs({
            name: "work",
            kind: "Unicast",
            direction: "MainToUtility",
         });
         const output = await render(utilityOnly, { getPathForFile: true });
         expect(output).toContain("export const api = {\n   getPathForFile:");
         expect(output).toContain('import { contextBridge, webUtils } from "electron";');
      });

      it("adds the helper to the file of every scope", async () => {
         const scoped = buildFileSpecs({
            name: "sendIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            scopes: ["settings"],
         });
         const output = await renderSpecs(
            VitestPreloadBindingsWriter,
            scoped,
            { getPathForFile: true },
            "settings",
         );
         expect(output).toContain(HELPER);
      });

      it("uses nothing of this library at runtime", async () => {
         const output = await render(channels, { getPathForFile: true });
         expect(output).not.toContain("automate-electron-ipc");
      });
   });

   describe("exposure of the API", () => {
      const channels = buildFileSpecs({
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
      });
      const render = (pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig>) =>
         renderSpecs(VitestPreloadBindingsWriter, pfsArray, config);
      const EXPOSE = (key: string) =>
         `export function expose(key = '${key}'): void {\n   contextBridge.exposeInMainWorld(key, api);\n}`;

      it("exports the API as `api`, and exposes it in the main world as 'ipc' by default", async () => {
         const output = await render(channels, {});
         expect(output).toContain("export const api = {\n   getIt: {");
         expect(output).toContain(EXPOSE("ipc"));
         expect(output.endsWith("}\n\nexpose();\n")).toBe(true);
         expect(output).not.toContain("exposeInIsolatedWorld");
      });

      it("exposes the API under the key of `exposeAs`", async () => {
         const output = await render(channels, { exposeAs: "api" });
         expect(output).toContain(EXPOSE("api"));
         expect(output).not.toContain("'ipc'");
      });

      it("exposes the API in the isolated world of `isolatedWorldId`", async () => {
         const output = await render(channels, { exposeAs: "bridge", isolatedWorldId: 1004 });
         expect(output).toContain(
            "export function expose(key = 'bridge'): void {\n   contextBridge.exposeInIsolatedWorld(1004, key, api);\n}",
         );
         expect(output).not.toContain("exposeInMainWorld");
      });

      it("calls `expose()` once, after the declaration of `expose`", async () => {
         const output = await render(channels, {});
         expect(output.match(/^expose\(\);$/gm)).toHaveLength(1);
         expect(output.indexOf("expose();")).toBeGreaterThan(
            output.indexOf("export function expose"),
         );
      });

      it("leaves the call out when `autoExpose` is false, and still exports `api` and `expose`", async () => {
         const output = await render(channels, { autoExpose: false, exposeAs: "bridge" });
         expect(output).toContain("export const api = {\n   getIt: {");
         expect(output).toContain(EXPOSE("bridge"));
         expect(output).not.toMatch(/^expose\(\);$/m);
         expect(output.endsWith("}\n")).toBe(true);
      });

      it("exposes with `autoExpose` true as it does without the option", async () => {
         expect(await render(channels, { autoExpose: true })).toBe(await render(channels, {}));
      });

      it("keeps the world of the config when `autoExpose` is false", async () => {
         const output = await render(channels, { autoExpose: false, isolatedWorldId: 2000 });
         expect(output).toContain("contextBridge.exposeInIsolatedWorld(2000, key, api);");
         expect(output).not.toMatch(/^expose\(\);$/m);
      });

      it("exposes the empty API the same way", async () => {
         expect(await render([], { exposeAs: "api" })).toBe(
            [
               'import { contextBridge } from "electron";',
               "",
               "export const api = {};",
               "",
               EXPOSE("api"),
               "",
               "expose();",
            ].join("\n"),
         );
         expect(await render([], { isolatedWorldId: 2000, autoExpose: false })).toBe(
            [
               'import { contextBridge } from "electron";',
               "",
               "export const api = {};",
               "",
               "export function expose(key = 'ipc'): void {",
               "   contextBridge.exposeInIsolatedWorld(2000, key, api);",
               "}",
            ].join("\n"),
         );
      });
   });
});
