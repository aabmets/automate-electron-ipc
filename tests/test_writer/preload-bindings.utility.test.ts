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
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter, utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels));
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   const utility: shared.SimpleChannel[] = [
      { name: "indexFile", kind: "Unicast", direction: "MainToUtility" },
      { name: "setLevel", kind: "Broadcast", direction: "MainToUtility" },
      { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" },
      { name: "progress", kind: "Broadcast", direction: "UtilityToMain" },
   ];

   it("writes the empty script when only utility channels are declared", async () => {
      const empty = await render();

      expect(await render(...utility)).toStrictEqual(empty);
      expect(empty).not.toContain("ipcRenderer");
   });

   it("leaves the utility channels out when renderer channels are declared as well", async () => {
      const alone = await render({ name: "getUser", kind: "Unicast", direction: "RendererToMain" });
      const mixed = await render(
         { name: "getUser", kind: "Unicast", direction: "RendererToMain" },
         ...utility,
      );

      expect(mixed).toStrictEqual(alone);
      for (const { name } of utility) {
         expect(mixed).not.toContain(name);
      }
   });
});

describe("PreloadBindingsWriter, renderer to utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
      });
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
      returnType: "AsyncIterable<number>",
   } as const;

   const mainStream = {
      name: "exportRows",
      kind: "Stream",
      direction: "RendererToMain",
      returnType: "AsyncIterable<number>",
   } as const;

   it("exposes invoke and stream, which call the client of the channel", async () => {
      const output = await render(streamUtility, invokeUtility);

      expect(output).toContain(
         "\n   queryRows: {\n      invoke: (...args: any[]) => callUtilityPort(utilityClients['queryRows'], args),\n   },",
      );
      expect(output).toContain(
         "\n   scanRows: {\n      stream: (...args: any[]) => openUtilityStream(utilityClients['scanRows'], args, 1024),\n   },",
      );
   });

   it("passes the window of the channel to the client of a stream, and grants credits to the child", async () => {
      const windowed = { ...streamUtility, name: "windowed", highWaterMark: 4 };
      const unbounded = {
         ...streamUtility,
         name: "unbounded",
         highWaterMark: Number.POSITIVE_INFINITY,
      };
      const output = await render(streamUtility, windowed, unbounded);

      for (const [name, window] of [
         ["scanRows", "1024"],
         ["windowed", "4"],
         ["unbounded", "Infinity"],
      ]) {
         expect(output).toContain(`openUtilityStream(utilityClients['${name}'], args, ${window})`);
      }
      expect(output).toContain("{ __ipc: 'credit', channel: client.channel, id, limit }");
   });

   it("listens for the port and the close of each channel, on the wire names, sorted", async () => {
      const output = await render(streamUtility, invokeUtility);

      expect(output).toContain(
         "function listenForUtilityPorts(name: string, channel: string): void {",
      );
      expect(output).toContain("ipcRenderer.on(`${channel}:close`,");
      const listeners = [...output.matchAll(/^listenForUtilityPorts\((.*)\);$/gm)].map((m) => m[1]);
      expect(listeners).toStrictEqual([
         "'queryRows', 'autoipc:queryRows'",
         "'scanRows', 'autoipc:scanRows'",
      ]);
   });

   it("writes the stream parts only when a stream channel is declared", async () => {
      const calls = await render(invokeUtility);
      const streams = await render(streamUtility);

      expect(calls).toContain("function callUtilityPort(");
      for (const name of ["openUtilityStream", "createStreamReader", "StreamResult"]) {
         expect(calls).not.toContain(name);
      }
      expect(streams).toContain("function openUtilityStream(");
      expect(streams).toContain("function createStreamReader(");
      expect(streams).toContain("function callUtilityPort(");
   });

   it("writes the error helpers once, and the reader once when both kinds of stream are declared", async () => {
      const output = await render(streamUtility, mainStream, invokeUtility);

      expect(output.match(/^function toIpcError\(/gm)).toHaveLength(1);
      expect(output.match(/^function createStreamReader\(/gm)).toHaveLength(1);
      expect(output).toContain("function openStream(");
      expect(output).toContain("function openUtilityStream(");
   });

   it("needs no stream of the main process, and imports nothing else of electron", async () => {
      const output = await render(invokeUtility);

      expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
      expect(output).not.toContain("IpcRendererEvent");
      expect(output).not.toContain("openStream");
      expect(output).not.toContain("withTimeout");
   });

   it("writes the stream of the main process on the reader that the streams share", async () => {
      const output = await render(mainStream);

      expect(output).toContain("const reader = createStreamReader(");
      expect(output).toContain("return reader.stream;");
      expect(output).not.toContain("utilityClients");
   });
});
