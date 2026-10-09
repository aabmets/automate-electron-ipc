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

import fsp from "node:fs/promises";
import scopes from "@src/scopes.js";
import writer from "@src/writer/index.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   describe("exposure of the API", () => {
      const channels = shared.buildFileSpecs({
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         errors: "NotFoundError",
      });
      const render = async (
         pfsArray: t.ParsedFileSpecs[],
         config: Partial<t.IPCResolvedConfig>,
      ) => {
         const obj = new shared.VitestRendererTypesWriter(pfsArray, config);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("declares the global variable as 'ipc' when the config says nothing", async () => {
         const output = await render(channels, {});
         expect(output).toContain("\n   var ipc: IpcApi;\n");
         expect(output).toContain("`ipc.<name>.invoke`");
      });

      it("declares the global variable under the name of `exposeAs`", async () => {
         const output = await render(channels, { exposeAs: "api" });
         expect(output).toContain("\n   var api: IpcApi;\n");
         expect(output).not.toContain("var ipc");
         expect(output).toContain("`api.<name>.invoke`");
         expect(output).toContain("`api.<name>.stream`");
         expect(output).not.toContain("`ipc.<name>");
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
   });

   describe("getPathForFile", () => {
      const channels = shared.buildFileSpecs(
         { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
         { name: "zed", kind: "Broadcast", direction: "RendererToMain" },
      );
      const render = async (
         pfsArray: t.ParsedFileSpecs[],
         config: Partial<t.IPCResolvedConfig>,
      ) => {
         const obj = new shared.VitestRendererTypesWriter(pfsArray, config);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("declares nothing when the config says nothing, or says false", async () => {
         const output = await render(channels, {});
         expect(output).not.toContain("getPathForFile");
         expect(await render(channels, { getPathForFile: false })).toBe(output);
      });

      it("declares the helper among the members of IpcApi, in name order", async () => {
         const output = await render(channels, { getPathForFile: true });
         const api = output.slice(
            output.indexOf("interface IpcApi"),
            output.indexOf("declare global"),
         );
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
      } as t.IPCResolvedConfig;
      const targetOf = (scope: string | null) =>
         (
            new writer.RendererTypesWriter(config, [], scope) as unknown as {
               getTargetFilePath(): string;
            }
         ).getTargetFilePath();
      const channels = shared.buildFileSpecs(
         {
            name: "getIt",
            kind: "Unicast",
            direction: "RendererToMain",
            returnType: "Promise<string>",
         },
         { name: "sendIt", kind: "Broadcast", direction: "RendererToMain", scopes: ["settings"] },
      );
      const render = async (scope: string | null) => {
         const obj = new shared.VitestRendererTypesWriter(
            scopes.filterByScope(channels, scope),
            {},
            scope,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

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

      it("tells that the file of a scope declares the same variable as the others", async () => {
         const output = await render("settings");

         expect(output).toContain(
            "The API of the scope 'settings': its own channels and the ones that have no scope.",
         );
         expect(output).toContain("so a project includes only one of them.");
         expect(output).toContain("\n   var ipc: IpcApi;\n");
      });

      it("has no such note in the file of the surface of no scope", async () => {
         expect(await render(null)).not.toContain("The API of the scope");
      });
   });

   describe("channel prefix", () => {
      it("does not change the declarations, since they use the names from the schema", async () => {
         const channels = [
            { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
            { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" },
            { name: "chatIt", kind: "Port", direction: "RendererToRenderer" },
         ] as const;
         const render = async (config: Partial<t.IPCResolvedConfig>) => {
            const obj = new shared.VitestRendererTypesWriter(
               shared.buildFileSpecs(...channels),
               config,
            );
            await obj.write(false);
            return (await fsp.readFile(obj.getTargetFilePath())).toString();
         };

         const prefixed = await render({ channelPrefix: "app:" });

         expect(prefixed).not.toContain("app:");
         expect(prefixed).toBe(await render({ channelPrefix: "" }));
      });
   });
});
