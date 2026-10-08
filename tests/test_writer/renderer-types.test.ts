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

   it("should write send, on, onReady, onClose, onOverflow and onConnection methods for Port channels", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestRendererTypesWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
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

   describe("ask channels", () => {
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestRendererTypesWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const ask = {
         name: "askIt",
         kind: "Unicast",
         direction: "MainToRenderer",
         params: ["id: number", "...rest: string[]"],
         returnType: "Promise<boolean>",
      } as const;

      it("declares a handle method which takes the responder and returns its disposer", async () => {
         const output = await render([ask]);

         expect(output).toContain(
            "askIt: {\n      handle: (callback: (id: number, ...rest: string[]) => Promise<boolean>) => () => void;\n   };",
         );
      });

      it("declares no error type, since the questions are asked by the main process", async () => {
         const output = await render([ask]);

         expect(output).not.toContain("IpcError");
         expect(output).not.toContain("@throws");
      });

      it("is the same with rawErrors and with a prefix", async () => {
         const plain = await render([ask]);

         expect(await render([ask], { rawErrors: true })).toBe(plain);
         expect(await render([ask], { channelPrefix: "app:" })).toBe(plain);
      });
   });
   describe("stream channels", () => {
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestRendererTypesWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const rows = {
         name: "exportRows",
         kind: "Stream",
         direction: "RendererToMain",
         params: ["table: string", "limit?: number"],
         returnType: "AsyncIterable<Row>",
      } as const;
      const invoke = {
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         returnType: "Promise<string>",
      } as const;

      it("declares a stream method which returns the stream of the chunk type", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "exportRows: {\n      /** @throws {IpcError} when the stream fails, from a read of the stream */\n      stream: (table: string, limit?: number) => IpcStream<Row>;\n   };",
         );
      });

      it("takes the chunk type from the first type argument of any iterable return type", async () => {
         const output = await render([
            {
               name: "a",
               kind: "Stream",
               direction: "RendererToMain",
               returnType: "AsyncGenerator<string, void, undefined>",
            },
            {
               name: "b",
               kind: "Stream",
               direction: "RendererToMain",
               returnType: "AsyncIterableIterator<number[]>",
            },
         ]);

         expect(output).toContain("stream: () => IpcStream<string>;");
         expect(output).toContain("stream: () => IpcStream<number[]>;");
      });

      it("declares IpcStream once, with next, return, cancel and the async iterator", async () => {
         const output = await render([rows, { ...rows, name: "other" }]);

         expect(output.match(/^interface IpcStream<T> \{/gm)).toHaveLength(1);
         expect(output).toContain("next(): Promise<IteratorResult<T, undefined>>;");
         expect(output).toContain("return(): Promise<IteratorResult<T, undefined>>;");
         expect(output).toContain("cancel(): void;");
         expect(output).toContain("[Symbol.asyncIterator](): IpcStream<T>;");
      });

      it("documents the error types of the stream, and declares IpcError", async () => {
         const output = await render([{ ...rows, errors: "NotFoundError | AuthError" }]);

         expect(output).toContain(
            "/** @throws {IpcError<NotFoundError | AuthError>} when the stream fails, from a read of the stream */",
         );
         expect(output).toContain("type IpcError<E extends Error = Error> =");
         expect(output).toContain("and that a read of `ipc.<name>.stream` is rejected with");
      });

      it("keeps the signature of a generic stream, and ignores rawErrors", async () => {
         const output = await render([
            {
               name: "generic",
               kind: "Stream",
               direction: "RendererToMain",
               params: ["seed: T"],
               returnType: "AsyncIterable<T>",
            },
         ]);

         expect(output).toContain("stream: (seed: T) => IpcStream<T>;");
         const raw = await render([rows], { rawErrors: true });
         expect(raw).toBe(await render([rows]));
      });

      it("declares nothing of streams for the other channels", async () => {
         const output = await render([invoke]);

         expect(output).not.toContain("IpcStream");
      });

      it("is the same with a prefix", async () => {
         expect(await render([rows], { channelPrefix: "app:" })).toBe(await render([rows]));
      });
   });
});
