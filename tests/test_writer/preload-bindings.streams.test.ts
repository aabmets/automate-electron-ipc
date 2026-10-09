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

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   describe("ask channels", () => {
      const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
      const askToo = { name: "askAlso", kind: "Unicast", direction: "MainToRenderer" } as const;
      const emit = { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" } as const;
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("exposes handle only, and listens for the questions of the channel", async () => {
         const output = await render([ask]);

         expect(output).toContain("\n   askIt: {\n      handle: (callback: Function) => {");
         expect(output).toContain("askHandlers['askIt'] = callback;");
         expect(output).toContain("if (askHandlers['askIt'] === callback) {");
         expect(output).toContain("delete askHandlers['askIt'];");
         expect(output).toContain(
            "ipcRenderer.on('askIt', (_event: unknown, id: unknown, ...args: any[]) => {",
         );
         expect(output).toContain("void answerAsk('askIt', 'askIt:reply', id, args);");
         expect(output).not.toContain("askIt: {\n      on:");
      });

      it("generates the answering code only when there is an ask", async () => {
         const emits = await render([emit]);

         expect(emits).not.toContain("answerAsk");
         expect(emits).not.toContain("askHandlers");
         expect(emits).not.toContain("toIpcError");
         expect(emits).toContain("on: (callback: Function) => {");
         const asks = await render([ask, emit]);
         expect(asks.match(/^async function answerAsk\(/gm)).toHaveLength(1);
         expect(asks.match(/^function toIpcError\(/gm)).toHaveLength(1);
         expect(asks).toContain("pushIt: {\n      on: (callback: Function) => {");
      });

      it("lists the listeners of the asks in name order, whatever the order of the schema", async () => {
         const output = await render([ask, askToo]);

         expect(output.indexOf("ipcRenderer.on('askAlso'")).toBeGreaterThan(-1);
         expect(output.indexOf("ipcRenderer.on('askAlso'")).toBeLessThan(
            output.indexOf("ipcRenderer.on('askIt'"),
         );
         expect(output).toBe(await render([askToo, ask]));
      });

      it("puts the prefix in front of the request and the reply channel", async () => {
         const output = await render([ask], { channelPrefix: "app:" });

         expect(output).toContain("ipcRenderer.on('app:askIt', ");
         expect(output).toContain("answerAsk('askIt', 'app:askIt:reply', id, args)");
         const bare = await render([ask], { channelPrefix: "" });
         expect(bare).toContain("answerAsk('askIt', 'askIt:reply', id, args)");
         expect(await render([ask], {})).toBe(bare);
      });

      it("is not changed by rawErrors, since the answer is always an envelope", async () => {
         expect(await render([ask], { rawErrors: true })).toBe(await render([ask]));
      });
   });

   describe("stream channels", () => {
      const rows = {
         name: "exportRows",
         kind: "Stream",
         direction: "RendererToMain",
         params: ["table: string"],
         returnType: "AsyncIterable<Row>",
      } as const;
      const tokens = {
         name: "tokens",
         kind: "Stream",
         direction: "RendererToMain",
         returnType: "AsyncIterable<string>",
      } as const;
      const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("exposes stream only, which opens a stream of the channel", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "\n   exportRows: {\n      stream: (...args: any[]) => openStream('exportRows', 'exportRows', args, 1024),\n   },",
         );
         expect(output).not.toContain("exportRows: {\n      invoke:");
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
            expect(output).toContain(`openStream('${name}', '${name}', args, ${window})`);
         }
      });

      it("grants credits from the reader, and only to a port that can be posted to", async () => {
         const output = await render([rows]);

         expect(output).toContain("highWaterMark: number, grant: (limit: number) => boolean");
         expect(output).toContain("port.postMessage({ type: 'credit', limit });");
         expect(output).toContain("Math.max(1, Math.ceil(highWaterMark / 2))");
         expect(output).toContain("reader.topUp();");
      });

      it("listens for the ports of the calls of every channel, in name order", async () => {
         const output = await render([tokens, rows]);

         expect(output).toContain("listenForStreamPorts('exportRows:port');");
         expect(output.indexOf("listenForStreamPorts('exportRows:port')")).toBeLessThan(
            output.indexOf("listenForStreamPorts('tokens:port')"),
         );
         expect(output).toBe(await render([rows, tokens]));
         expect(output.match(/^function openStream\(/gm)).toHaveLength(1);
         expect(output.match(/^function listenForStreamPorts\(/gm)).toHaveLength(1);
      });

      it("calls the main process with invoke, the ID in front of the arguments", async () => {
         const output = await render([rows]);

         expect(output).toContain("ipcRenderer.invoke(wire, id, ...args).then(");
         expect(output).toContain("[Symbol.asyncIterator]: () => stream,");
      });

      it("sends the cancel message and closes the port, and fails a port which closes early", async () => {
         const output = await render([rows]);

         expect(output).toContain("() => port?.postMessage({ type: 'cancel' }),");
         expect(output).toContain("code: 'IPC_STREAM_CLOSED'");
         expect(output).toContain("code: 'IPC_STREAM_INVALID_REPLY'");
      });

      it("shares the error helpers with the ask channels, which are declared once", async () => {
         const both = await render([rows, ask]);

         expect(both.match(/^function toIpcError\(/gm)).toHaveLength(1);
         expect(both.match(/^interface IpcErrorInfo \{/gm)).toHaveLength(1);
         expect(both).toContain("async function answerAsk(");
         expect(both).toContain("function openStream(");
         const streams = await render([rows]);
         expect(streams).toContain("function toIpcError(");
         expect(streams).not.toContain("answerAsk");
         expect(streams).not.toContain("askHandlers");
      });

      it("generates nothing of streams for the other channels", async () => {
         const output = await render([ask]);

         expect(output).not.toContain("openStream");
         expect(output).not.toContain("listenForStreamPorts");
      });

      it("puts the prefix in front of the request and the port channel only", async () => {
         const output = await render([rows], { channelPrefix: "app:" });

         expect(output).toContain("openStream('exportRows', 'app:exportRows', args, 1024)");
         expect(output).toContain("listenForStreamPorts('app:exportRows:port');");
         const bare = await render([rows], { channelPrefix: "" });
         expect(bare).toContain("openStream('exportRows', 'exportRows', args, 1024)");
         expect(await render([rows], {})).toBe(bare);
      });

      it("is not changed by rawErrors, since the call is always answered with an envelope", async () => {
         expect(await render([rows], { rawErrors: true })).toBe(await render([rows]));
      });
   });
});
