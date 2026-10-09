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
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("should write a port channel per Port channel, with the listeners of its port and its end", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain(
         "function createPortChannel(channel: string, wire: string, max: number): PortChannel {",
      );
      expect(output).toContain(
         "ports['vitestChannel'] = createPortChannel('vitestChannel', 'vitestChannel', 1000);",
      );
      expect(output).toContain(
         "ipcRenderer.on('vitestChannel', (event: IpcRendererEvent, key: unknown) => {\n   ports['vitestChannel'].pair(key, event.ports[0]);\n});",
      );
      expect(output).toContain(
         "ipcRenderer.on('vitestChannel:close', (_event: IpcRendererEvent, key: unknown) => {\n   ports['vitestChannel'].end(key);\n});",
      );
      expect(output).toContain(
         "export const api = {\n   vitestChannel: ports['vitestChannel'].api,\n};",
      );
      for (const member of ["send", "on", "onReady", "onClose", "onOverflow", "onConnection"]) {
         expect(output).toMatch(new RegExp(`^ {6}${member}: `, "m"));
      }
      expect(output).not.toMatch(/sendMessage|onMessage|getPortObject|PortObject/);
   });

   it("should queue the sends until the port is there, and tell the subscribers apart", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain("enqueue(queue, args, channel, max, overflow);");
      expect(output).toContain("enqueue(pending, args, channel, max, ownOverflow ?? overflow);");
      expect(output).toContain("for (const args of pending.items.splice(0)) {");
      expect(output).toContain("const listener = { callback };");
      expect(output).toContain("if (port === next) {");
   });

   it("should create each port channel with its name, wire name and maxQueue", async () => {
      const specs = shared.buildFileSpecs(
         { name: "bounded", kind: "Port", direction: "RendererToRenderer", maxQueue: 5 },
         { name: "none", kind: "Port", direction: "MainToRenderer", maxQueue: 0 },
         {
            name: "unbounded",
            kind: "Port",
            direction: "RendererToRenderer",
            maxQueue: Number.POSITIVE_INFINITY,
         },
         { name: "plain", kind: "Port", direction: "MainToRenderer" },
      );
      const obj = new shared.VitestPreloadBindingsWriter(specs, { channelPrefix: "app:" });
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "ports['bounded'] = createPortChannel('bounded', 'app:bounded', 5);",
      );
      expect(output).toContain("ports['none'] = createPortChannel('none', 'app:none', 0);");
      expect(output).toContain(
         "ports['unbounded'] = createPortChannel('unbounded', 'app:unbounded', Infinity);",
      );
      expect(output).toContain("ports['plain'] = createPortChannel('plain', 'app:plain', 1000);");
   });

   it("should hand the new message but not the queue to the overflow callback of the page", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "action = overflow(args, { channel, max, dropped: before, warnings: queue.warnings });",
      );
      expect(output).not.toMatch(/overflow\([^)]*queue\.items/);
   });

   it("should keep a connection per key, and end one through the main process", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).toContain("const connections = new Map<string, PortConnection>();");
      expect(output).toContain("onConnection: (callback: Function) => {");
      expect(output).toContain("close: () => {");
      expect(output).toContain("ipcRenderer.send(`${wire}:disconnect`, key);");
   });

   it("should give a mainPort channel the same page API as a port channel", async () => {
      const render = async (direction: "RendererToRenderer" | "MainToRenderer") => {
         const specs = shared.buildFileSpecs({ name: "alpha", kind: "Port", direction });
         const obj = new shared.VitestPreloadBindingsWriter(specs);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      expect(await render("MainToRenderer")).toStrictEqual(await render("RendererToRenderer"));
   });

   it("should write one object per channel, sorted by name, next to the port objects", async () => {
      const pfsArray = shared.buildFileSpecs(
         { name: "zeta", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "alpha", kind: "Port", direction: "RendererToRenderer" },
         { name: "Beta", kind: "Unicast", direction: "RendererToMain" },
         { name: "gamma", kind: "Broadcast", direction: "RendererToMain" },
      );
      const obj = new shared.VitestPreloadBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      const exposed = output.slice(output.indexOf("export const api"));
      expect([...exposed.matchAll(/^ {3}(\w+): /gm)].map((match) => match[1])).toStrictEqual([
         "Beta",
         "alpha",
         "gamma",
         "zeta",
      ]);
      expect(exposed).toContain("Beta: {\n      invoke: async (...args: any[]) => {");
      expect(exposed).toContain("gamma: {\n      send: (...args: any[]) =>");
      expect(exposed).toContain("zeta: {\n      on: (callback: Function) => {");
   });

   describe("subscriptions of main to renderer channels", () => {
      const channels = [
         { name: "getIt", kind: "Unicast", direction: "RendererToMain" },
         { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "pushAlso", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "askIt", kind: "Unicast", direction: "MainToRenderer" },
      ] as const;
      const render = async (
         specs: readonly shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...specs),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("shares one ipcRenderer listener per channel, which on and once both use", async () => {
         const output = await render(channels);

         expect(output.match(/function listenToChannel\(/g)).toHaveLength(1);
         // The one listener is added by listenToChannel, and no subscription adds one of its own.
         expect(output.match(/ipcRenderer\.on\(channel, listener\);/g)).toHaveLength(1);
         expect(output).not.toContain("ipcRenderer.once(");
         expect(output).toContain("return listenToChannel('pushIt', callback, false);");
         expect(output).toContain("return listenToChannel('pushIt', callback, true);");
         expect(output).toContain("return listenToChannel('pushAlso', callback, false);");
         expect(output).toContain("ipcRenderer.removeListener(channel, subscription.listener);");
      });

      it("writes the helper only for a page that subscribes to a message of the main process", async () => {
         expect(await render([channels[0]])).not.toContain("listenToChannel");
         // An ask is answered by one responder, and does not subscribe.
         expect(await render([channels[0], channels[3]])).not.toContain("listenToChannel");
         expect(await render([channels[1]])).toContain("function listenToChannel(");
      });

      it("is set off from the components around it by one blank line", async () => {
         const output = await render([
            ...channels,
            { name: "chatIt", kind: "Port", direction: "RendererToRenderer" },
         ]);

         expect(output).toContain("function createPortChannel(");
         expect(output).toContain("function toIpcError(");
         expect(output).toMatch(/[^\n]\n\ninterface ChannelSubscriber \{/);
         expect(output).toMatch(/subscription\.listener\);\n {3}\}\n\}\n\n[a-z]/);
      });

      it("reads the arguments of a message once, before the subscribers are called", async () => {
         const output = await render([channels[1]]);

         expect(output).toContain("const args = read ? read(received) : received;");
         expect(output.indexOf("const args = read ?")).toBeLessThan(
            output.indexOf("next.callback(...args)"),
         );
      });

      it("removes a once subscriber before its callback runs, and skips the ones removed during a dispatch", async () => {
         const output = await render([channels[1]]);

         expect(output.indexOf("unlistenToChannel(channel, next);")).toBeLessThan(
            output.indexOf("next.callback(...args)"),
         );
         expect(output).toContain("for (const next of subscribers.slice()) {");
         expect(output).toContain("if (subscribers.indexOf(next) < 0) {");
      });
   });
});
