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

import { renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestRendererTypesWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("RendererTypesWriter", () => {
   mockGetTargetFilePath(VitestRendererTypesWriter);

   describe("ask channels", () => {
      const render = (
         channels: Parameters<typeof buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => renderWith(VitestRendererTypesWriter, channels, config);
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
      const render = (
         channels: Parameters<typeof buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => renderWith(VitestRendererTypesWriter, channels, config);
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
