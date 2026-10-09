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

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   describe("mainPort channels", () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const mainPort = { name: "tail", kind: "Port", direction: "MainToRenderer" } as const;
      const port = { name: "chat", kind: "Port", direction: "RendererToRenderer" } as const;

      it("should write a typed connect method which returns the connection of one contents", async () => {
         const pfsArray = shared.vitestChannelSpecs.Port_MainToRenderer;
         const obj = new shared.VitestMainBindingsWriter(pfsArray);
         await obj.write(false);
         const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

         expect(output).toContain(
            'import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";',
         );
         expect(output).toContain(
            'import type { BrowserWindow, IpcMainEvent, WebContents, WebContentsView, MessagePortMain } from "electron";',
         );
         expect(output).toContain(
            "connect: (target: BrowserWindow | WebContents | WebContentsView): " +
               "{ send: (arg1: string, arg2: string) => void; " +
               "on: (callback: (arg1: string, arg2: string) => void) => () => void; " +
               "onReady: (callback: () => void) => () => void; " +
               "onClose: (callback: () => void) => () => void; " +
               "onOverflow: (callback: ((queue: Parameters<(arg1: string, arg2: string) => void>[], message: Parameters<(arg1: string, arg2: string) => void>, info: PortOverflowInfo) => Parameters<(arg1: string, arg2: string) => void>[]) | undefined) => () => void; " +
               "close: () => void } => connectMainPort('vitestChannel', 'vitestChannel', 1000, target),",
         );
         // The helper for two windows is not there.
         expect(output).not.toContain("connectPorts");
      });

      it("should keep the main end of a MessageChannelMain, and give the page the other", async () => {
         const output = await render(mainPort);

         expect(output).toContain("const { port1, port2 } = new MessageChannelMain();");
         expect(output).toContain("attach(port1);");
         expect(output).toContain("contents.postMessage(channel, key, [port2]);");
         expect(output).toContain("next.on('message', (event: { data: unknown }) => {");
         expect(output).toContain("next.on('close', () => {");
         expect(output).toContain("next.start();");
         expect(output).toContain("next.postMessage(args);");
         expect(output).toContain("const watch = watchPageLoad(contents, () => pair());");
         expect(output).toContain(
            "const isReady = () => !contents.isDestroyed() && watch.isLoaded();",
         );
         expect(output).toContain("watch.dispose();");
         // The page counts as loaded from the event, since `isLoading()` is still true then.
         expect(output.slice(output.indexOf("function connectMainPort"))).not.toContain(
            "isLoading",
         );
         expect(output).toContain("contents.send(`${channel}:close`, key);");
      });

      it("should end the connection when the contents are destroyed or the page asks for it", async () => {
         const output = await render(mainPort);

         expect(output).toContain("unwatchDestroyed = watchEvent(contents, 'destroyed', close);");
         expect(output).not.toContain("contents.on('destroyed'");
         expect(output).toContain("portEnds.set(key, { contents, close });");
         expect(output).toContain("listenForPortDisconnects(channel);");
      });

      it("should send the messages in order once the port is there, never before", async () => {
         const output = await render(mainPort);

         expect(output).toContain(
            "enqueueMainPort(pending, args, name, max, ownOverflow ?? portsConfig.onOverflow);",
         );
         expect(output).toContain("for (const args of pending.items.splice(0)) {");
      });

      it("should declare only the helpers that the port channels use", async () => {
         const onlyMain = await render(mainPort);
         const onlyRenderers = await render(port);
         const both = await render(mainPort, port);

         expect(onlyMain).toContain("function connectMainPort(");
         expect(onlyMain).not.toContain("function connectPorts(");
         expect(onlyRenderers).toContain("function connectPorts(");
         expect(onlyRenderers).not.toContain("connectMainPort");
         expect(onlyRenderers).not.toContain("MessagePortMain");
         expect(both).toContain("function connectMainPort(");
         expect(both).toContain("function connectPorts(");
         // The registry of the ends is shared, so it is declared once.
         expect(both.match(/const portEnds = /g)).toHaveLength(1);
      });

      it("should reserve the names that the helpers declare, so that schema types are renamed", () => {
         const generator = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(mainPort));
         const names = (
            generator as unknown as { getReservedNames(): string[] }
         ).getReservedNames();

         for (const name of [
            "connectMainPort",
            "configurePorts",
            "PortOverflowInfo",
            "PortsConfig",
            "MainPortConnection",
            "MainPortListener",
            "MessagePortMain",
            "Map",
            "Set",
            "Function",
         ]) {
            expect(names).toContain(name);
         }
      });

      it("should pass the maxQueue of the channel to the connection, and the default of 1000 without one", async () => {
         const output = await render(
            { ...mainPort, name: "bounded", maxQueue: 5 },
            { ...mainPort, name: "none", maxQueue: 0 },
            { ...mainPort, name: "unbounded", maxQueue: Number.POSITIVE_INFINITY },
            { ...mainPort, name: "plain" },
         );

         expect(output).toContain("connectMainPort('bounded', 'bounded', 5, target)");
         expect(output).toContain("connectMainPort('none', 'none', 0, target)");
         expect(output).toContain("connectMainPort('unbounded', 'unbounded', Infinity, target)");
         expect(output).toContain("connectMainPort('plain', 'plain', 1000, target)");
      });

      it("should declare configurePorts and the overflow types only for mainPort channels", async () => {
         const onlyMain = await render(mainPort);
         const onlyRenderers = await render(port);

         expect(onlyMain).toContain("export function configurePorts(config: PortsConfig): void {");
         expect(onlyMain).toContain("export interface PortOverflowInfo {");
         expect(onlyMain).toContain("function enqueueMainPort(");
         expect(onlyRenderers).not.toContain("configurePorts");
         expect(onlyRenderers).not.toContain("PortOverflowInfo");
         expect(onlyRenderers).not.toContain("enqueueMainPort");
      });

      it("should type the overflow callback of a connection with the parameters of the signature", async () => {
         const output = await render({ ...mainPort, params: ["line: string", "level?: number"] });

         expect(output).toContain(
            "onOverflow: (callback: ((queue: Parameters<(line: string, level?: number) => void>[], " +
               "message: Parameters<(line: string, level?: number) => void>, info: PortOverflowInfo) " +
               "=> Parameters<(line: string, level?: number) => void>[]) | undefined) => () => void;",
         );
      });

      it("should put the prefix in front of the name that is passed to Electron", async () => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(mainPort), {
            channelPrefix: "app:",
         });
         await obj.write(false);
         const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

         expect(output).toContain("connectMainPort('app:tail', 'tail', 1000, target)");
      });
   });
});
