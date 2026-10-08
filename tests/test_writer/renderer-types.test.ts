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
import utils from "@src/utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   it("should write empty Window declaration as a module when pfsArray is empty", async () => {
      const obj = new shared.VitestRendererTypesWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = "\nexport {};\n\ndeclare global {\n   interface Window {}\n}";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  sendVitestChannel: (arg1: CustomType, arg2?: CustomType) => Promise<string>;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Broadcast RendererToMain callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  sendVitestChannel: (arg1: string, arg2: string) => void;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Broadcast MainToRenderer callables into Window declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  onCustomListener1: (callback: (arg1: number, ...arg2: number) => Promise<CustomType>) => void;
                  onCustomListener2: (callback: (arg1: number, ...arg2: number) => Promise<CustomType>) => void;
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should type senders by channel kind, not by the declared return type", async () => {
      // Regression for B7: `ipcRenderer.send` returns `undefined`, so Broadcast senders are
      // `void` even when the declared signature returns a promise.
      const pfsArray = shared.buildFileSpecs(
         {
            name: "sendIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            params: ["text: string"],
            returnType: "Promise<void>",
         },
         { name: "syncIt", kind: "Unicast", direction: "RendererToMain", returnType: "number" },
         {
            name: "lookalikeIt",
            kind: "Unicast",
            direction: "RendererToMain",
            returnType: "PromiseResult",
         },
         {
            name: "asyncIt",
            kind: "Unicast",
            direction: "RendererToMain",
            params: ["id: number"],
            returnType: "Promise<string>",
         },
      );
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain("sendAsyncIt: (id: number) => Promise<string>;");
      expect(output).toContain("sendSendIt: (text: string) => void;");
      expect(output).toContain("sendSyncIt: () => Promise<Awaited<number>>;");
      // Regression for T56: a user type whose name starts with "Promise" is not a promise.
      expect(output).toContain("sendLookalikeIt: () => Promise<Awaited<PromiseResult>>;");
   });

   it("should write only ports into Window declaration when there are no callables", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         declare global {
            interface Window {
               ipc: {
                  ports: {
                     vitestChannel: {
                        sendMessage: (arg1: string, arg2: string) => void;
                        onMessage: (callback: (arg1: string, arg2: string) => void) => void;
                     };
                  };
               };
            }
         }\n
         export default Window;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput);
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
                  signature: {
                     definition: "() => Promise<User>",
                     params: [],
                     returnType: "Promise<User>",
                     customTypes: ["User"],
                     async: true,
                  },
               },
            ],
         },
      });
      const obj = new shared.VitestRendererTypesWriter([pfsOf("a", "getA"), pfsOf("b", "getB")]);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toMatch(/^import type \{ User \} from ".*\/a";$/m);
      expect(output).toMatch(/^import type \{ User as User_2 \} from ".*\/b";$/m);
      expect(output).toContain("sendGetA: () => Promise<User>;");
      expect(output).toContain("sendGetB: () => Promise<User_2>;");
   });
});
