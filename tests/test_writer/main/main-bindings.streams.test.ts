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
import { VitestMainBindingsWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   describe("stream channels", () => {
      const rows = {
         name: "exportRows",
         kind: "Stream",
         direction: "RendererToMain",
         params: ["table: string", "limit?: number"],
         returnType: "AsyncIterable<Row>",
      } as const;
      const tokens = {
         name: "tokens",
         kind: "Stream",
         direction: "RendererToMain",
         returnType: "AsyncGenerator<string, void, undefined>",
      } as const;
      const invoke = {
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         returnType: "Promise<string>",
      } as const;
      const render = (
         channels: Parameters<typeof buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => renderWith(VitestMainBindingsWriter, channels, config);

      it("generates handle only, which takes an async generator and gets the event first", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "handle: (callback: (event: IpcMainInvokeEvent, table: string, limit?: number) => AsyncIterable<Row>, options?: IpcListenOptions) => {",
         );
         expect(output).not.toContain("handleOnce");
         expect(output).toContain("target.ipc.handle('exportRows', listener);");
         expect(output).toContain("target.handlers['exportRows'] = listener;");
         expect(output).toContain("target.ipc.removeHandler('exportRows');");
      });

      it("keeps the type of an AsyncGenerator return as written", async () => {
         const output = await render([tokens]);

         expect(output).toContain(
            "handle: (callback: (event: IpcMainInvokeEvent) => AsyncGenerator<string, void, undefined>, options?: IpcListenOptions) => {",
         );
      });

      it("takes the stream ID as the first argument after the event, and starts the stream", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "const listener = (event: IpcMainInvokeEvent, id: unknown, ...rest: unknown[]) =>",
         );
         expect(output).toContain(
            "settleInvoke(() => startStream(event, 'exportRows', 'exportRows', id, 1024, () => (handler as (...rest: unknown[]) => unknown)(event, ...rest)));",
         );
      });

      it("passes the window of the channel to the stream: 1024 chunks, or the highWaterMark", async () => {
         const windowed = { ...rows, name: "windowed", highWaterMark: 4 };
         const pulled = { ...rows, name: "pulled", highWaterMark: 0 };
         const unbounded = { ...rows, name: "unbounded", highWaterMark: Number.POSITIVE_INFINITY };
         const output = await render([rows, windowed, pulled, unbounded]);

         for (const [name, window] of [
            ["exportRows", "1024"],
            ["windowed", "4"],
            ["pulled", "0"],
            ["unbounded", "Infinity"],
         ]) {
            expect(output).toContain(
               `startStream(event, '${name}', '${name}', id, ${window}, () =>`,
            );
         }
      });

      it("pauses the pump at the limit, and resumes it on a credit, a cancel or a stop", async () => {
         const output = await render([rows]);

         expect(output).toContain("highWaterMark: number,");
         expect(output).toContain("let limit = highWaterMark;");
         expect(output).toContain("if (sent >= limit) {");
         expect(output).toContain(
            "data.type === 'credit' && typeof data.limit === 'number' && data.limit > limit",
         );
         expect(output).toContain("sent += 1;");
         // The stop of a stream wakes the pump that waits, so that it can end.
         expect(output).toMatch(/done = true;\n\s+resume\(\);/);
         // The check comes before the generator is asked for a chunk.
         expect(output.indexOf("if (sent >= limit) {")).toBeLessThan(
            output.indexOf("step = await iterator.next();"),
         );
      });

      it("declares the stream helper once, and the electron imports it needs", async () => {
         const output = await render([rows, tokens]);

         expect(output.match(/^async function startStream\(/gm)).toHaveLength(1);
         expect(output.match(/^function stopIterator\(/gm)).toHaveLength(1);
         expect(output).toContain(
            'import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";',
         );
         expect(output).toContain(
            'import type { IpcMainInvokeEvent, WebContents, WebFrameMain, IpcMain } from "electron";',
         );
      });

      it("hands the port to the sender frame, falls back to the contents and sends in order", async () => {
         const output = await render([rows]);

         expect(output).toContain("const { port1, port2 } = new MessageChannelMain();");
         expect(output).toContain("let target: WebContents | WebFrameMain = event.sender;");
         expect(output).toContain("target.postMessage(`${wire}:port`, id, [port2]);");
         expect(output).toContain("port1.postMessage({ type: 'chunk', value: step.value });");
         expect(output).toContain("port1.postMessage({ type: 'end' });");
         expect(output).toContain("port1.postMessage({ type: 'error', error });");
      });

      it("cancels on a cancel message, a closed port and destroyed contents", async () => {
         const output = await render([rows]);

         expect(output).toContain("if (data && data.type === 'cancel') {");
         expect(output).toContain("port1.on('close', cancel);");
         expect(output).toContain("unwatch = watchEvent(sender, 'destroyed', cancel);");
         expect(output).not.toMatch(/sender\.(on|once|removeListener)\(/);
         expect(output).toContain("Promise.resolve(iterator.return?.())");
      });

      it("reports a chunk which cannot be sent, and a handler which returns no async iterable", async () => {
         const output = await render([rows]);

         expect(output).toContain("code: 'IPC_STREAM_UNSENDABLE'");
         expect(output).toContain("code: 'IPC_STREAM_NOT_ITERABLE'");
         expect(output).toContain("code: 'IPC_STREAM_INVALID_REQUEST'");
      });

      it("uses the sender checks and the envelope of the invoke channels", async () => {
         const output = await render([rows]);

         expect(output).toContain("function isSenderAllowed(");
         expect(output).toContain("function settleInvoke(");
         expect(output).toContain("function toIpcError(");
         expect(output).toContain("if (!isSenderAllowed(event, 'exportRows')) {");
         expect(output).toContain("throw new IpcForbiddenError('exportRows');");
      });

      it("puts the allowed origins and the validator in front of the handler", async () => {
         const output = await render([
            {
               ...rows,
               allowedOrigins: ["app://."],
               validate: { name: "tableArgs", exported: "tableArgs", fromPath: "./v" },
            },
         ]);

         expect(output).toContain("isSenderAllowed(event, 'exportRows', [\"app://.\"])");
         expect(output).toContain("validateArguments(event, 'exportRows', tableArgs, ");
         expect(output).toContain("function validateArguments<R>(");
      });

      it("always uses the envelope, whatever rawErrors says", async () => {
         const raw = await render([rows], { rawErrors: true });

         expect(raw).toBe(await render([rows]));
         expect(raw).toContain("settleInvoke(() => startStream(");
         expect(await render([invoke], { rawErrors: true })).not.toContain("settleInvoke");
      });

      it("leaves the invoke channels next to it as they are", async () => {
         const both = await render([rows, invoke]);

         expect(both).toContain(
            "handleOnce: (callback: (event: IpcMainInvokeEvent) => Promise<string>, options?: IpcListenOptions)",
         );
         expect(both).toContain(
            "const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>",
         );
         expect(both.match(/import \{ ipcMain as electronIpcMain/g)).toHaveLength(1);
      });

      it("puts the prefix in front of the request and the port channel", async () => {
         const output = await render([rows], { channelPrefix: "app:" });

         expect(output).toContain("target.ipc.handle('app:exportRows', listener);");
         expect(output).toContain("startStream(event, 'exportRows', 'app:exportRows', id, 1024, ");
         const bare = await render([rows], { channelPrefix: "" });
         expect(bare).toContain("startStream(event, 'exportRows', 'exportRows', id, 1024, ");
         expect(await render([rows], {})).toBe(bare);
      });

      it("names the generated variables apart from the parameters of the signature", async () => {
         const output = await render([
            {
               name: "clash",
               kind: "Stream",
               direction: "RendererToMain",
               params: ["event: string", "id: number", "rest: boolean", "handler: string"],
               returnType: "AsyncIterable<string>",
            },
         ]);

         expect(output).toContain(
            "const listener = (_event: IpcMainInvokeEvent, _id: unknown, ..._rest: unknown[]) =>",
         );
         expect(output).toContain(
            "startStream(_event, 'clash', 'clash', _id, 1024, () => (_handler as (..._rest: unknown[]) => unknown)(_event, ..._rest))",
         );
      });

      it("generates nothing of streams for the other channels", async () => {
         const output = await render([invoke]);

         expect(output).not.toContain("startStream");
         expect(output).not.toContain("stopIterator");
         expect(output).not.toContain("MessageChannelMain");
         expect(output).not.toContain("MessagePortMain");
      });
   });
});
