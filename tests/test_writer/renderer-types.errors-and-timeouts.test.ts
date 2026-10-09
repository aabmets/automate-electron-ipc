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
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestRendererTypesWriter);

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

      it("reserves IpcTimeoutError for the declared type", () => {
         const obj = new shared.VitestRendererTypesWriter([]);
         const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

         expect(names).toContain("IpcTimeoutError");
      });

      it("reserves IpcError and Error for the declared type", () => {
         const obj = new shared.VitestRendererTypesWriter([]);
         const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

         expect(names).toEqual(expect.arrayContaining(["IpcError", "Error", "IpcApi"]));
      });
   });

   describe("invoke timeouts", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
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

      it("declares and documents nothing for a channel without a timeout", async () => {
         const output = await render([unicast]);

         expect(output).not.toContain("IpcTimeoutError");
         expect(output).toContain("/** @throws {IpcError} */");
      });

      it("adds the timeout error to the documented errors of the channel", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }]);

         expect(output).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
         expect(output).toContain(
            "type IpcTimeoutError = Error & { name: 'IpcTimeoutError'; code: 'IPC_TIMEOUT' };",
         );
         expect(output).toContain("type IpcError<E extends Error = Error>");
      });

      it("joins it with the declared errors of the handler", async () => {
         const output = await render([{ ...unicast, errors: "NotFoundError", timeoutMs: 500 }]);

         expect(output).toContain("/** @throws {IpcError<NotFoundError | IpcTimeoutError>} */");
      });

      it("documents the timeout of the config on every invoke", async () => {
         const output = await render([unicast], { timeoutMs: 2500 });

         expect(output).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
      });

      it("lets 0 turn the documentation off for one channel", async () => {
         const output = await render([{ ...unicast, timeoutMs: 0 }], { timeoutMs: 2500 });

         expect(output).not.toContain("IpcTimeoutError");
      });

      it("documents only the timeout when rawErrors is set, since Electron reports the rest", async () => {
         const output = await render([{ ...unicast, errors: "NotFoundError", timeoutMs: 500 }], {
            rawErrors: true,
         });

         expect(output).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
         expect(output).not.toContain("NotFoundError");
      });
   });
});
