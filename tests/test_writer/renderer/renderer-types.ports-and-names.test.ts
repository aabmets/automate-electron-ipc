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
import { dedent } from "@testutils/text-utils.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   it("should write send, on, onReady, onClose, onOverflow and onConnection methods for Port channels", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
         interface IpcPortOverflowInfo {
            channel: string;
            max: number;
            dropped: number;
            warnings: number;
         }

         type IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';

         interface IpcApi {
            vitestChannel: {
               send: (arg1: string, arg2: string) => void;
               on: (callback: (arg1: string, arg2: string) => void) => () => void;
               onReady: (callback: () => void) => () => void;
               onClose: (callback: () => void) => () => void;
               onOverflow: (callback: (message: Parameters<(arg1: string, arg2: string) => void>, info: IpcPortOverflowInfo) => IpcPortOverflowAction) => () => void;
               onConnection: (callback: (connection: { send: (arg1: string, arg2: string) => void; on: (callback: (arg1: string, arg2: string) => void) => () => void; onReady: (callback: () => void) => () => void; onClose: (callback: () => void) => () => void; onOverflow: (callback: (message: Parameters<(arg1: string, arg2: string) => void>, info: IpcPortOverflowInfo) => IpcPortOverflowAction) => () => void; close: () => void }) => void) => () => void;
            };
         }

         declare global {
            var ipc: IpcApi;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(`${expectedOutput.trim()}\n`);
   });

   it("should declare the overflow types only if a port channel uses them", async () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestRendererTypesWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      const withPort = await render({ name: "a", kind: "Port", direction: "RendererToRenderer" });
      const without = await render({ name: "b", kind: "Broadcast", direction: "RendererToMain" });

      expect(withPort).toContain("interface IpcPortOverflowInfo {");
      expect(withPort).toContain(
         "type IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';",
      );
      expect(without).not.toContain("IpcPortOverflow");
   });

   it("should type a mainPort channel like a port channel, since the page has the same API", async () => {
      const render = async (name: string, direction: "RendererToRenderer" | "MainToRenderer") => {
         const specs = shared.buildFileSpecs({ name, kind: "Port", direction });
         const obj = new shared.VitestRendererTypesWriter(specs);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      expect(await render("alpha", "MainToRenderer")).toStrictEqual(
         await render("alpha", "RendererToRenderer"),
      );
   });

   it("should write one object per channel, sorted by name, with no ports object", async () => {
      const pfsArray = shared.buildFileSpecs(
         { name: "zeta", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "alpha", kind: "Port", direction: "RendererToRenderer" },
         { name: "Beta", kind: "Unicast", direction: "RendererToMain" },
         { name: "gamma", kind: "Broadcast", direction: "RendererToMain" },
      );
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      const keys = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(keys).toStrictEqual(["Beta", "alpha", "gamma", "zeta"]);
      expect(output).not.toMatch(/\bports\b|Window|sendMessage|onMessage/);
   });

   it("should not take the name of the generated interface for a schema type", async () => {
      const pfsArray = [
         {
            fullPath: "/project/ipc/schema.ts",
            relativePath: "schema.ts",
            specs: {
               channelMapExport: { kind: "default" },
               importSpecArray: [],
               typeSpecArray: [
                  { name: "IpcApi", kind: "interface", generics: null, isExported: true },
               ],
               channelSpecArray: [
                  {
                     name: "getApi",
                     kind: "Unicast",
                     direction: "RendererToMain",
                     signature: shared.parseTestSignature("() => Promise<IpcApi>"),
                  },
               ],
            },
         },
      ] as t.ParsedFileSpecs[];
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toMatch(/^import type \{ IpcApi as IpcApi_2 \} from ".*\/schema";$/m);
      expect(output).toContain("invoke: () => Promise<IpcApi_2>;");
      expect(output).toContain("interface IpcApi {");
   });

   it("should import colliding type names under distinct names and use them in signatures", async () => {
      const pfsOf = (file: string, channel: string): t.ParsedFileSpecs => ({
         fullPath: `/project/${file}.ts`,
         relativePath: `${file}.ts`,
         specs: {
            channelMapExport: { kind: "default" },
            importSpecArray: [],
            typeSpecArray: [
               { name: "User", kind: "interface" as t.TypeKind, generics: null, isExported: true },
            ],
            channelSpecArray: [
               {
                  name: channel,
                  kind: "Unicast",
                  direction: "RendererToMain",
                  signature: shared.parseTestSignature("() => Promise<User>"),
               },
            ],
         },
      });
      const obj = new shared.VitestRendererTypesWriter([pfsOf("a", "getA"), pfsOf("b", "getB")]);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toMatch(/^import type \{ User \} from ".*\/a";$/m);
      expect(output).toMatch(/^import type \{ User as User_2 \} from ".*\/b";$/m);
      expect(output).toContain("invoke: () => Promise<User>;");
      expect(output).toContain("invoke: () => Promise<User_2>;");
   });
});
