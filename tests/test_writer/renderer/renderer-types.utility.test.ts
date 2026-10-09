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
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter, utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestRendererTypesWriter(shared.buildFileSpecs(...channels));
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const utility: shared.SimpleChannel[] = [
      {
         name: "indexFile",
         kind: "Unicast",
         direction: "MainToUtility",
         returnType: "Promise<number>",
      },
      { name: "setLevel", kind: "Broadcast", direction: "MainToUtility" },
      { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" },
      { name: "progress", kind: "Broadcast", direction: "UtilityToMain" },
   ];

   it("writes the empty declaration when only utility channels are declared", async () => {
      const empty = await render();

      expect(await render(...utility)).toStrictEqual(empty);
   });

   it("leaves the utility channels out when renderer channels are declared as well", async () => {
      const alone = await render({ name: "getUser", kind: "Unicast", direction: "RendererToMain" });
      const mixed = await render(
         { name: "getUser", kind: "Unicast", direction: "RendererToMain" },
         ...utility,
      );

      expect(mixed).toStrictEqual(alone);
   });
});

describe("RendererTypesWriter, renderer to utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestRendererTypesWriter(shared.buildFileSpecs(...channels));
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const invokeUtility = {
      name: "queryRows",
      kind: "Unicast",
      direction: "RendererToUtility",
      params: ["sql: string"],
      returnType: "Promise<number>",
   } as const;
   const streamUtility = {
      name: "scanRows",
      kind: "Stream",
      direction: "RendererToUtility",
      params: ["table: string"],
      returnType: "AsyncIterable<number>",
   } as const;

   it("types invoke and stream, which can fail with the library's error", async () => {
      const output = await render(invokeUtility, streamUtility);

      expect(output).toContain(
         "   queryRows: {\n      /** @throws {IpcError<IpcUtilityError>} */\n      invoke: (sql: string) => Promise<number>;\n   };",
      );
      expect(output).toContain(
         "      /** @throws {IpcError<IpcUtilityError>} when the stream fails, from a read of the stream */\n      stream: (table: string) => IpcStream<number>;",
      );
      expect(output).toContain("interface IpcStream<T> {");
   });

   it("lists the declared errors in front of the library's", async () => {
      const output = await render(
         { ...invokeUtility, errors: "NotFound | Denied" },
         { ...streamUtility, errors: "Denied" },
      );

      expect(output).toContain("/** @throws {IpcError<NotFound | Denied | IpcUtilityError>} */");
      expect(output).toContain(
         "/** @throws {IpcError<Denied | IpcUtilityError>} when the stream fails, from a read of the stream */",
      );
   });

   it("wraps a result which is not a promise, as the invoke of the main process does", async () => {
      const output = await render({ ...invokeUtility, returnType: "number" });

      expect(output).toContain("invoke: (sql: string) => Promise<Awaited<number>>;");
   });

   it("declares IpcUtilityError, with its codes, only for such a schema", async () => {
      const output = await render(invokeUtility);
      const plain = await render({ name: "getUser", kind: "Unicast", direction: "RendererToMain" });

      expect(output).toContain("type IpcUtilityError = Error & {");
      expect(output).toContain("name: 'IpcUtilityError';");
      for (const code of ["EXITED", "UNSENDABLE", "INVALID_REPLY", "NO_HANDLER", "NOT_ITERABLE"]) {
         expect(output).toContain(`'IPC_UTILITY_${code}'`);
      }
      expect(output).toContain("type IpcError<E extends Error = Error>");
      expect(plain).not.toContain("IpcUtilityError");
   });

   it("keeps the channels between the processes out, as before", async () => {
      const only = await render({ name: "indexFile", kind: "Unicast", direction: "MainToUtility" });

      expect(only).toStrictEqual(await render());
   });
});
