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

describe("RendererTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   it("should write an empty ipc declaration as a module when pfsArray is empty", async () => {
      const obj = new shared.VitestRendererTypesWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
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
      const expectedOutput = utils.dedent(`
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
             * throws. It is a plain object, since contextBridge does not keep the fields of an \`Error\`.
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
      const expectedOutput = utils.dedent(`
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
      const expectedOutput = utils.dedent(`
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

   it("should write send and on methods for Port channels", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         interface IpcApi {
            vitestChannel: {
               send: (arg1: string, arg2: string) => void;
               on: (callback: (arg1: string, arg2: string) => void) => void;
            };
         }

         declare global {
            var ipc: IpcApi;
         }

         export {};
      `);
      expect(buffer.toString()).toStrictEqual(`${expectedOutput.trim()}\n`);
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

   describe("error types", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
      const render = async (
         channels: shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestRendererTypesWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("documents the declared errors of an invoke", async () => {
         const output = await render([{ ...unicast, errors: "NotFoundError | AuthError" }]);

         expect(output).toContain(
            "getIt: {\n      /** @throws {IpcError<NotFoundError | AuthError>} */\n      invoke:",
         );
      });

      it("documents the general error shape for an invoke without declared errors", async () => {
         const output = await render([unicast]);

         expect(output).toContain("/** @throws {IpcError} */");
      });

      it("declares the IpcError type once, only when an invoke can reject", async () => {
         expect(
            (await render([unicast, { ...unicast, name: "getOther" }])).match(/type IpcError</g),
         ).toHaveLength(1);
         expect(await render([broadcast])).not.toContain("IpcError");
         expect(await render([])).not.toContain("IpcError");
      });

      it("declares IpcError among the globals, next to ipc", async () => {
         const output = await render([unicast]);

         expect(output).toMatch(/declare global \{\n {3}var ipc: IpcApi;\n {3}\/\*\*/);
         expect(output).toContain("name: E['name']; message: string");
         expect(output).toContain("{ code: C }");
         expect(output).toContain("{ data: D }");
      });

      it("documents and declares nothing when rawErrors is set", async () => {
         const output = await render([{ ...unicast, errors: "NotFoundError" }], {
            rawErrors: true,
         });

         expect(output).not.toContain("IpcError");
         expect(output).not.toContain("@throws");
         expect(output).toContain("invoke: () => Promise<Awaited<void>>;");
      });

      it("reserves IpcError and Error for the declared type", () => {
         const obj = new shared.VitestRendererTypesWriter([]);
         const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

         expect(names).toEqual(expect.arrayContaining(["IpcError", "Error", "IpcApi"]));
      });
   });
});
