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

describe("MainBindingsWriter, renderer to utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const invokeUtility = {
      name: "queryRows",
      kind: "Unicast",
      direction: "RendererToUtility",
      params: ["sql: string"],
      returnType: "Promise<Row[]>",
   } as const;
   const streamUtility = {
      name: "scanRows",
      kind: "Stream",
      direction: "RendererToUtility",
      returnType: "AsyncIterable<Row>",
   } as const;
   const callUtility = { name: "indexFile", kind: "Unicast", direction: "MainToUtility" } as const;
   const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;
   const port = { name: "chat", kind: "Port", direction: "RendererToRenderer" } as const;
   const mainPort = { name: "logTail", kind: "Port", direction: "MainToRenderer" } as const;

   const render = async (...channels: shared.SimpleChannel[]) => {
      const writer = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
      });
      await writer.write(false);
      return (await fsp.readFile(writer.getTargetFilePath())).toString();
   };

   it("writes connect for both kinds, with the child and the target, and nothing of the signature", async () => {
      const output = await render(invokeUtility, streamUtility);

      for (const name of ["queryRows", "scanRows"]) {
         expect(output).toContain(
            [
               `   ${name}: {`,
               "      connect: (child: UtilityProcess, target: BrowserWindow | WebContents | WebContentsView): { close: () => void } => " +
                  `connectUtilityPort('autoipc:${name}', child, target),`,
               "   },",
            ].join("\n"),
         );
      }
      expect(output).not.toContain("sql: string");
   });

   it("imports only what the broker and the peers of the children use, and needs no ipcMain", async () => {
      const output = await render(invokeUtility, streamUtility);

      expect(output).toContain('import { utilityProcess, MessageChannelMain } from "electron";');
      expect(output).toContain(
         'import type { UtilityProcess, BrowserWindow, WebContents, WebContentsView } from "electron";',
      );
      for (const name of ["ipcMain", "IpcForbiddenError", "import type { Row"]) {
         expect(output).not.toContain(name);
      }
   });

   it("writes the broker: the load watch, the link per channel and page, and the port message", async () => {
      const output = await render(invokeUtility);

      expect(output).toContain("function watchPageLoad(contents: WebContents,");
      expect(output).toContain("function connectUtilityPort(");
      expect(output).toContain("const linkKey = `${channel}:${contents.id}`;");
      expect(output).toContain("child.postMessage({ __ipc: 'port', channel, key }, [port1]);");
      expect(output).toContain("contents.postMessage(channel, key, [port2]);");
      expect(output).toContain("contents.send(`${channel}:close`, key);");
      expect(output).toContain(
         "unwatch.push(watchEvent(contents, 'destroyed', close), watchEvent(child, 'exit', close));",
      );
      // The single listener of attachUtility remains, and the connection adds none of its own (T87).
      expect(output.match(/child\.(once|on)\('exit'/g)).toHaveLength(1);
      expect(output).not.toContain("child.removeListener('exit'");
      expect(output).toContain("utilityLinks.get(linkKey)?.();");
   });

   it("writes the load watch once when port channels share the file, and leaves the ports alone", async () => {
      const both = await render(invokeUtility, port, mainPort);
      const ports = await render(port, mainPort);

      expect(both.match(/^function watchPageLoad\(/gm)).toHaveLength(1);
      expect(ports.match(/^function watchPageLoad\(/gm)).toHaveLength(1);
      expect(ports).not.toContain("connectUtilityPort");
      expect(both).toContain("function connectPorts(");
   });

   it("writes the page load watch before the broker helper, which uses it", async () => {
      const output = await render(invokeUtility);

      expect(output.indexOf("function watchPageLoad(")).toBeLessThan(
         output.indexOf("function connectUtilityPort("),
      );
   });

   it("writes nothing of the broker for the other channels", async () => {
      const output = await render(renderer, callUtility);

      for (const name of ["connectUtilityPort", "utilityLinks", "watchPageLoad"]) {
         expect(output).not.toContain(name);
      }
      expect(output).toContain("attachUtility");
   });

   it("writes the peers for a schema with only renderer to utility channels", async () => {
      const output = await render(invokeUtility);

      expect(output).toContain("export function attachUtility(child: UtilityProcess): void {");
      expect(output).toContain("export function forkUtility(");
      expect(output).toContain("export class IpcUtilityError extends Error {");
      expect(output).toContain('import { utilityProcess, MessageChannelMain } from "electron";');
   });

   it("makes connect fail for a child that was never attached, or that exited", async () => {
      const output = await render(invokeUtility);

      const start = output.indexOf("function connectUtilityPort(");
      const connect = output.slice(start, output.indexOf("\n}\n", start));
      expect(connect).toContain("if (getUtilityPeer(child, channel).closed) {");
      expect(connect).toContain("'IPC_UTILITY_EXITED'");
      // Before the earlier connection is closed and before anything is registered.
      expect(connect.indexOf("getUtilityPeer(child, channel)")).toBeLessThan(
         connect.indexOf("utilityLinks.get(linkKey)?.()"),
      );
   });

   it("keeps the peer of the channels between the processes next to the broker", async () => {
      const output = await render(callUtility, invokeUtility);

      expect(output).toContain("const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();");
      expect(output).toContain("function connectUtilityPort(");
      expect(output.match(/UtilityProcess[,\s]/g)?.length).toBeGreaterThan(1);
   });

   it("reserves the names of the broker, and Map, only for such a schema", () => {
      const reserved = (...channels: shared.SimpleChannel[]) =>
         (
            new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels)) as unknown as {
               getReservedNames: () => string[];
            }
         ).getReservedNames();

      for (const name of ["connectUtilityPort", "utilityLinks", "lastUtilityLinkId"]) {
         expect(reserved(renderer)).toContain(name);
      }
      expect(reserved(invokeUtility)).toContain("Map");
      expect(reserved(invokeUtility)).toContain("UtilityProcess");
      expect(reserved(renderer)).not.toContain("Map");
      expect(reserved(port)).toContain("Map");
   });
});
