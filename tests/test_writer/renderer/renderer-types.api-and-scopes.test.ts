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
import { HelperTypesWriter } from "@src/writer/renderer/helper-types.js";
import { RendererTypesWriter } from "@src/writer/renderer/renderer-types.js";
import { renderApiSpecs, renderApiWith, renderSpecs } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import {
   VitestHelperTypesWriter,
   VitestRendererTypesWriter,
} from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mockGetTargetFilePath(VitestRendererTypesWriter);
   mockGetTargetFilePath(VitestHelperTypesWriter);

   describe("exposure of the API", () => {
      const channels = buildFileSpecs({
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         errors: "NotFoundError",
      });
      const render = (pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig>) =>
         renderSpecs(VitestRendererTypesWriter, pfsArray, config);

      it("declares the global variable as 'ipc' when the config says nothing", async () => {
         const output = await render(channels, {});
         expect(output).toContain("\n   var ipc: IpcApi;\n");
      });

      it("takes IpcApi from the types module, which is written next to the file", async () => {
         expect(await render(channels, {})).toMatch(
            /^import type \{ IpcApi \} from "\.\/types";\n\ndeclare global \{\n/,
         );
         expect(await render([], {})).toContain('import type { IpcApi } from "./types";');
      });

      it("declares the global variable under the name of `exposeAs`", async () => {
         const output = await render(channels, { exposeAs: "api" });
         expect(output).toContain("\n   var api: IpcApi;\n");
         expect(output).not.toContain("var ipc");
      });

      it("documents the calls under the name of `exposeAs` in the types module", async () => {
         const output = await renderApiSpecs(channels, { exposeAs: "api" });
         expect(output).toContain("`api.<name>.invoke`");
         expect(output).toContain("`api.<name>.stream`");
         expect(output).not.toContain("`ipc.<name>");
         expect(await renderApiSpecs(channels, {})).toContain("`ipc.<name>.invoke`");
      });

      it("declares the variable of the empty API under the name of `exposeAs`", async () => {
         expect(await render([], { exposeAs: "api" })).toContain("var api: IpcApi;");
      });

      it("documents that the variable exists only in the isolated world", async () => {
         const output = await render(channels, { exposeAs: "bridge", isolatedWorldId: 1004 });
         expect(output).toContain(
            "   /** Exposed in the isolated world 1004, so only scripts of that world can use it. */\n   var bridge: IpcApi;",
         );
      });

      it("has no such note for the main world", async () => {
         expect(await render(channels, {})).not.toContain("isolated world");
      });

      it("declares the error types as globals that name the ones of the types module", async () => {
         const output = await render(channels, {});
         expect(output).toContain(
            '   type IpcError<E extends Error = Error> = import("./types").IpcError<E>;\n',
         );
         expect(output).not.toContain("IpcTimeoutError");
         expect(output).not.toContain("IpcUtilityError");
      });

      it("declares the timeout and utility errors only for the channels that can fail with them", async () => {
         const timed = buildFileSpecs({
            name: "getIt",
            kind: "Unicast",
            direction: "RendererToMain",
            timeoutMs: 500,
         });
         const utility = buildFileSpecs({
            name: "getIt",
            kind: "Unicast",
            direction: "RendererToUtility",
         });
         expect(await render(timed, {})).toContain(
            '   type IpcTimeoutError = import("./types").IpcTimeoutError;\n',
         );
         expect(await render(utility, {})).toContain(
            '   type IpcUtilityError = import("./types").IpcUtilityError;\n',
         );
      });

      it("declares no error type for a channel that cannot fail", async () => {
         const output = await render(
            buildFileSpecs({ name: "sendIt", kind: "Broadcast", direction: "RendererToMain" }),
            {},
         );
         expect(output).not.toContain("IpcError");
      });
   });

   describe("getPathForFile", () => {
      const channels = buildFileSpecs(getIt, {
         name: "zed",
         kind: "Broadcast",
         direction: "RendererToMain",
      });
      const render = (pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig>) =>
         renderApiSpecs(pfsArray, config);

      it("declares nothing when the config says nothing, or says false", async () => {
         const output = await render(channels, {});
         expect(output).not.toContain("getPathForFile");
         expect(await render(channels, { getPathForFile: false })).toBe(output);
      });

      it("declares the helper among the members of IpcApi, in name order", async () => {
         const output = await render(channels, { getPathForFile: true });
         const api = output.slice(output.indexOf("interface IpcApi"));
         expect([...api.matchAll(/^ {3}(\w+): /gm)].map((match) => match[1])).toStrictEqual([
            "getIt",
            "getPathForFile",
            "zed",
         ]);
         expect(output).toContain("   getPathForFile: (file: File) => string;\n");
      });

      it("declares the helper in the empty API as well", async () => {
         const output = await render([], { getPathForFile: true });
         expect(output).toContain("interface IpcApi {\n");
         expect(output).toContain("   getPathForFile: (file: File) => string;\n}");
      });
   });

   describe("scopes", () => {
      const config = {
         codeIndent: 3,
         rendererTypesFilePath: "/p/ipc/window.d.ts",
         typesFilePath: "/p/ipc/types.ts",
      } as t.IPCResolvedConfig;
      const targetOf = (scope: string | null) =>
         (
            new RendererTypesWriter(config, [], scope) as unknown as {
               getTargetFilePath(): string;
            }
         ).getTargetFilePath();
      const channels = buildFileSpecs(
         {
            name: "getIt",
            kind: "Unicast",
            direction: "RendererToMain",
            returnType: "Promise<string>",
         },
         { name: "sendIt", kind: "Broadcast", direction: "RendererToMain", scopes: ["settings"] },
      );
      const render = (scope: string | null) =>
         renderApiSpecs(filterByScope(channels, scope), {}, scope);

      it("writes the file of the surface of no scope to the usual path", () => {
         expect(targetOf(null)).toBe("/p/ipc/window.d.ts");
      });

      it("writes the file of a scope next to it, named after the scope", () => {
         expect(targetOf("settings")).toBe("/p/ipc/window.settings.d.ts");
         expect(targetOf("plugin-host")).toBe("/p/ipc/window.plugin-host.d.ts");
      });

      it("declares the channels of the surface of the scope only", async () => {
         expect(await render(null)).not.toContain("sendIt");
         expect(await render("editor")).not.toContain("sendIt");
         expect(await render("settings")).toContain("   sendIt: {\n      send: () => void;");
         expect(await render("settings")).toContain("   getIt: {");
      });

      it("tells that the file of a scope declares the same variable as the others", () => {
         const output = renderSpecs(
            VitestRendererTypesWriter,
            filterByScope(channels, "settings"),
            {},
            "settings",
         );

         expect(output).toContain(
            "The API of the scope 'settings': its own channels and the ones that have no scope.",
         );
         expect(output).toContain("so a project includes only one of them.");
         expect(output).toContain("\n   var ipc: IpcApi;\n");
      });

      it("has no such note in the file of the surface of no scope", () => {
         const output = renderSpecs(VitestRendererTypesWriter, filterByScope(channels, null), {});
         expect(output).not.toContain("The API of the scope");
      });

      it("writes the types module of a scope next to the one of the surface of no scope", () => {
         const typesOf = (scope: string | null) =>
            (
               new HelperTypesWriter(config, [], scope) as unknown as {
                  getTargetFilePath(): string;
               }
            ).getTargetFilePath();
         expect(typesOf(null)).toBe("/p/ipc/types.ts");
         expect(typesOf("settings")).toBe("/p/ipc/types.settings.ts");
      });

      it("takes the types from the types module of the same scope", () => {
         const surface = filterByScope(channels, "settings");
         const settings = new RendererTypesWriter(config, surface, "settings").render(false);
         const plain = new RendererTypesWriter(config, filterByScope(channels, null), null).render(
            false,
         );
         expect(settings).toContain('import type { IpcApi } from "./types.settings";');
         expect(plain).toContain('import type { IpcApi } from "./types";');
      });
   });

   describe("channel prefix", () => {
      it("does not change the declarations, since they use the names from the schema", async () => {
         const channels = [
            getIt,
            { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" },
            { name: "chatIt", kind: "Port", direction: "RendererToRenderer" },
         ] as const;
         const render = (config: Partial<t.IPCResolvedConfig>) => renderApiWith(channels, config);

         const prefixed = await render({ channelPrefix: "app:" });

         expect(prefixed).not.toContain("app:");
         expect(prefixed).toBe(await render({ channelPrefix: "" }));
      });
   });
});
