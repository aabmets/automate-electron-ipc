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

import { dedent } from "@testutils/text-utils.js";
import { renderApiSpecs } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestHelperTypesWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, vitestChannelSpecs } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("HelperTypesWriter", () => {
   mockGetTargetFilePath(VitestHelperTypesWriter);

   it("should write an empty ipc declaration as a module when pfsArray is empty", async () => {
      const buffer = await renderApiSpecs([]);
      const expectedOutput = dedent(`
         export interface IpcApi {}
      `);
      expect(buffer.toString()).toStrictEqual(`${expectedOutput.trim()}\n`);
   });

   it("should write Unicast RendererToMain callables into the ipc declaration", async () => {
      const pfsArray = vitestChannelSpecs.Unicast_RendererToMain;
      const buffer = await renderApiSpecs(pfsArray);
      const expectedOutput = dedent(`
         export interface IpcApi {
            vitestChannel: {
               /** @throws {IpcError} */
               invoke: (arg1: CustomType, arg2?: CustomType) => Promise<string>;
            };
         }

         /**
          * The object that the promise of \`ipc.<name>.invoke\` is rejected with when the handler
          * throws, and that a read of \`ipc.<name>.stream\` is rejected with when the stream fails.
          * It is a plain object, since contextBridge does not keep the fields of an \`Error\`.
          */
         export type IpcError<E extends Error = Error> = E extends unknown
            ? { name: E['name']; message: string } & (E extends { code: infer C extends string | number }
               ? { code: C }
               : { code?: string | number }) & (E extends { data: infer D }
               ? { data: D }
               : { data?: unknown })
            : never;
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast RendererToMain callables into the ipc declaration", async () => {
      const pfsArray = vitestChannelSpecs.Broadcast_RendererToMain;
      const buffer = await renderApiSpecs(pfsArray);
      const expectedOutput = dedent(`
         export interface IpcApi {
            vitestChannel: {
               send: (arg1: string, arg2: string) => void;
            };
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast MainToRenderer callables into the ipc declaration", async () => {
      const pfsArray = vitestChannelSpecs.Broadcast_MainToRenderer;
      const buffer = await renderApiSpecs(pfsArray);
      const expectedOutput = dedent(`
         export interface IpcApi {
            vitestChannel: {
               on: (callback: (arg1: number, ...arg2: number[]) => Promise<CustomType>) => () => void;
               once: (callback: (arg1: number, ...arg2: number[]) => Promise<CustomType>) => () => void;
            };
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should type senders by channel kind, not by the declared return type", async () => {
      // Regression for B7: `ipcRenderer.send` returns `undefined`, so Broadcast senders are
      // `void` even when the declared signature returns a promise.
      const pfsArray = buildFileSpecs(
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
      const output = await renderApiSpecs(pfsArray);

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
