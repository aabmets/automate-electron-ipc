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
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   it("should write an empty ipc declaration as a module when pfsArray is empty", async () => {
      const obj = new shared.VitestRendererTypesWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
         interface IpcApi {}

         declare global {
            var ipc: IpcApi;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(`${expectedOutput.trim()}\n`);
   });

   it("should write Unicast RendererToMain callables into the ipc declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
         interface IpcApi {
            vitestChannel: {
               /** @throws {IpcError} */
               invoke: (arg1: CustomType, arg2?: CustomType) => Promise<string>;
            };
         }

         declare global {
            var ipc: IpcApi;
            /**
             * The object that the promise of \`ipc.<name>.invoke\` is rejected with when the handler
             * throws, and that a read of \`ipc.<name>.stream\` is rejected with when the stream fails.
             * It is a plain object, since contextBridge does not keep the fields of an \`Error\`.
             */
            type IpcError<E extends Error = Error> = E extends unknown
               ? { name: E['name']; message: string } & (E extends { code: infer C extends string | number }
                  ? { code: C }
                  : { code?: string | number }) & (E extends { data: infer D }
                  ? { data: D }
                  : { data?: unknown })
               : never;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast RendererToMain callables into the ipc declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
         interface IpcApi {
            vitestChannel: {
               send: (arg1: string, arg2: string) => void;
            };
         }

         declare global {
            var ipc: IpcApi;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast MainToRenderer callables into the ipc declaration", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = dedent(`
         interface IpcApi {
            vitestChannel: {
               on: (callback: (arg1: number, ...arg2: number[]) => Promise<CustomType>) => () => void;
               once: (callback: (arg1: number, ...arg2: number[]) => Promise<CustomType>) => () => void;
            };
         }

         declare global {
            var ipc: IpcApi;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
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

      expect(output).toContain(
         "asyncIt: {\n      /** @throws {IpcError} */\n      invoke: (id: number) => Promise<string>;",
      );
      expect(output).toContain("sendIt: {\n      send: (text: string) => void;");
      expect(output).toContain(
         "syncIt: {\n      /** @throws {IpcError} */\n      invoke: () => Promise<Awaited<number>>;",
      );
      // Regression for T56: a user type whose name starts with "Promise" is not a promise.
      expect(output).toContain(
         "lookalikeIt: {\n      /** @throws {IpcError} */\n      invoke: () => Promise<Awaited<PromiseResult>>;",
      );
   });
});
