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
import {
   askWorker,
   emitToWorker,
   invokeFromWorker,
   renderer,
   sendFromWorker,
} from "@testutils/service-worker-writer-utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("ServiceWorkerTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestServiceWorkerTypesWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestServiceWorkerTypesWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels only when the schema has a channel to or from a service worker", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestServiceWorkerTypesWriter(
            shared.buildFileSpecs(...channels),
         ).hasChannels();

      expect(has(renderer)).toBe(false);
      expect(has(renderer, askWorker)).toBe(true);
   });

   it("declares the API of the worker for its own channels", async () => {
      const output = await render([
         {
            ...invokeFromWorker,
            params: ["scope: string"],
            returnType: "Promise<string>",
            errors: "AuthError",
         },
         { ...sendFromWorker, params: ["n: number"] },
         { ...askWorker, params: ["force: boolean"], returnType: "number" },
         { ...emitToWorker, params: ["key: string"] },
         renderer,
      ]);

      expect(output).toContain("interface IpcApi {");
      expect(output).toContain("/** @throws {IpcError<AuthError>} */");
      expect(output).toContain("invoke: (scope: string) => Promise<string>;");
      expect(output).toContain("send: (n: number) => void;");
      expect(output).toContain("handle: (callback: (force: boolean) => number) => () => void;");
      expect(output).toContain("on: (callback: (key: string) => void) => () => void;");
      expect(output).toContain("var ipc: IpcApi;");
      const names = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(names).toStrictEqual(["configChanged", "flush", "getToken", "syncDone"]);
   });

   it("declares the global under the exposeAs name, without the helper for files", async () => {
      const output = await render([invokeFromWorker], {
         exposeAs: "workerIpc",
         getPathForFile: true,
         isolatedWorldId: 1001,
      });

      expect(output).toContain("var workerIpc: IpcApi;");
      expect(output).not.toContain("getPathForFile");
      expect(output).not.toContain("isolated world");
   });

   it("declares no timeout error without a timeout", async () => {
      const output = await render([invokeFromWorker]);
      expect(output).not.toContain("IpcTimeoutError");
   });

   it("declares the timeout error for a call that times out, by option or by the default", async () => {
      const byOption = await render([{ ...invokeFromWorker, timeoutMs: 500 }]);
      expect(byOption).toContain("type IpcTimeoutError =");
      expect(byOption).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
      const byDefault = await render([invokeFromWorker], { timeoutMs: 500 });
      expect(byDefault).toContain("type IpcTimeoutError =");
      const off = await render([{ ...invokeFromWorker, timeoutMs: 0 }], { timeoutMs: 500 });
      expect(off).not.toContain("IpcTimeoutError");
   });

   it("leaves the timeout error out with rawErrors, which has no envelope for it", async () => {
      const output = await render([{ ...invokeFromWorker, timeoutMs: 500 }], { rawErrors: true });
      expect(output).not.toContain("IpcTimeoutError");
   });

   it("declares no timeout error for a message or a question", async () => {
      const output = await render([sendFromWorker, askWorker, emitToWorker], { timeoutMs: 500 });
      expect(output).not.toContain("IpcTimeoutError");
   });
});
