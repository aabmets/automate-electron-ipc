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

describe("MainBindingsWriter, utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const callUtility = { name: "indexFile", kind: "Unicast", direction: "MainToUtility" } as const;
   const notifyUtility = {
      name: "setLevel",
      kind: "Broadcast",
      direction: "MainToUtility",
   } as const;
   const callMain = { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" } as const;
   const notifyMain = { name: "progress", kind: "Broadcast", direction: "UtilityToMain" } as const;
   const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const writer = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await writer.write(false);
      return (await fsp.readFile(writer.getTargetFilePath())).toString();
   };

   it("passes the timeout of a call to the child as the last argument", async () => {
      const output = await render(
         [
            { ...callUtility, timeoutMs: 1000, params: ["path: string"] },
            { ...callUtility, name: "plain" },
            { ...callUtility, name: "patient", timeoutMs: 0 },
            { ...notifyUtility, timeoutMs: 5 },
         ],
         { timeoutMs: 2500 },
      );

      expect(output).toContain("callUtilityChild(child, 'autoipc:indexFile', [path], 1000)");
      expect(output).toContain("'autoipc:plain', [], 2500)");
      expect(output).toContain("callUtilityChild(child, 'autoipc:patient', [])");
      expect(output).not.toMatch(/sendUtilityPeer\([^)]*\), \d+\)/);
   });

   it("writes the timer into the peer, with the timeout code", async () => {
      const output = await render([callUtility]);

      expect(output).toContain("timeoutMs = 0): Promise<unknown> {");
      expect(output).toContain("'IPC_UTILITY_TIMEOUT'");
      expect(output).toContain("}, Math.min(timeoutMs, 2147483647));");
   });

   it("writes nothing of the utility protocol for a schema without such channels", async () => {
      const output = await render([renderer]);

      for (const name of ["UtilityProcess", "IpcUtilityError", "attachUtility", "WeakMap"]) {
         expect(output).not.toContain(name);
      }
   });

   it("imports nothing but the type of the child when only utility channels are declared", async () => {
      const output = await render([callUtility, callMain]);

      expect(output).toContain('import type { UtilityProcess } from "electron";');
      expect(output).not.toContain("ipcMain");
      expect(output).not.toContain("IpcForbiddenError");
      expect(output).toContain("async function settleInvoke(");
   });

   it("writes the envelope once when renderer and utility channels share the file", async () => {
      const output = await render([renderer, callUtility]);

      expect(output.split("function toIpcError(").length).toBe(2);
      expect(output).toContain(
         'import type { IpcMainInvokeEvent, UtilityProcess, IpcMain, WebContents } from "electron";',
      );
   });

   it("writes the peer of a child, and attachUtility", async () => {
      const output = await render([callUtility]);

      expect(output).toContain("const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();");
      expect(output).toContain(
         "child.on('message', (message: unknown) => receiveUtilityMessage(peer, message));",
      );
      expect(output).toContain(
         "child.once('exit', () => closeUtilityPeer(peer, 'The utility process exited'));",
      );
      expect(output).toContain("export function attachUtility(child: UtilityProcess): void {");
   });

   it("writes forkUtility, which forks with electron and attaches the child at once", async () => {
      const output = await render([callUtility]);

      expect(output).toContain(
         "export function forkUtility(...args: Parameters<typeof utilityProcess.fork>): UtilityProcess {",
      );
      expect(output).toMatch(
         /const child = utilityProcess\.fork\(\.\.\.args\);\n\s+attachUtility\(child\);\n\s+return child;/,
      );
      expect(output).toContain('import { utilityProcess } from "electron";');
      expect(output).toContain('import type { UtilityProcess } from "electron";');
   });

   it("rejects a child that was never attached with IPC_UTILITY_NOT_ATTACHED, and never makes a peer lazily", async () => {
      const output = await render([callUtility]);

      const start = output.indexOf("function getUtilityPeer(");
      const getter = output.slice(start, output.indexOf("\n}\n", start));
      expect(getter).toContain("if (!known) {");
      expect(getter).toContain("'IPC_UTILITY_NOT_ATTACHED'");
      expect(getter).toContain("forkUtility()");
      expect(getter).toContain("attachUtility(child)");
      expect(getter).not.toContain("utilityPeers.set");
      expect(getter).not.toContain("createUtilityPeer");
   });

   it("makes invoke reject, and not throw, for a child that was never attached", async () => {
      const output = await render([callUtility]);

      const start = output.indexOf("function callUtilityChild(");
      const helper = output.slice(start, output.indexOf("\n}\n", start));
      expect(helper).toContain(
         "callUtilityPeer(getUtilityPeer(child, channel), channel, args, timeoutMs)",
      );
      expect(helper).toContain("return Promise.reject(error);");
   });

   it("attaches a child once", async () => {
      const output = await render([callUtility]);

      const start = output.indexOf("export function attachUtility(");
      const attach = output.slice(start, output.indexOf("\n}\n", start));
      expect(attach).toContain("if (utilityPeers.has(child)) {");
      expect(attach.indexOf("utilityPeers.has(child)")).toBeLessThan(
         attach.indexOf("createUtilityPeer("),
      );
   });

   it("writes invoke for calls to the child, with the child first", async () => {
      const output = await render([
         {
            ...callUtility,
            params: ["path: string", "...tags: string[]"],
            returnType: "Promise<number>",
         },
         { ...callUtility, name: "plain", returnType: "number" },
      ]);

      expect(output).toContain(
         [
            "   indexFile: {",
            "      invoke: (child: UtilityProcess, path: string, ...tags: string[]): Promise<number> =>",
            "         callUtilityChild(child, 'autoipc:indexFile', [path, ...tags]) as Promise<number>,",
            "   },",
         ].join("\n"),
      );
      expect(output).toContain(
         "invoke: (child: UtilityProcess): Promise<Awaited<number>> =>\n         callUtilityChild(child, 'autoipc:plain', []) as Promise<Awaited<number>>,",
      );
   });

   it("writes send for notifications to the child", async () => {
      const output = await render([{ ...notifyUtility, params: ["level: string"] }]);

      expect(output).toContain(
         [
            "   setLevel: {",
            "      send: (child: UtilityProcess, level: string): void =>",
            "         sendUtilityPeer(getUtilityPeer(child, 'autoipc:setLevel'), 'autoipc:setLevel', [level]),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes handle per child for calls of the child", async () => {
      const output = await render([{ ...callMain, params: ["key: string"], returnType: "string" }]);

      expect(output).toContain(
         [
            "   getSetting: {",
            "      handle: (child: UtilityProcess, callback: (key: string) => string) =>",
            "         setUtilityHandler(getUtilityPeer(child, 'autoipc:getSetting'), 'autoipc:getSetting', callback),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes on and once per child for notifications of the child", async () => {
      const output = await render([{ ...notifyMain, params: ["done: number"] }]);

      expect(output).toContain(
         [
            "   progress: {",
            "      on: (child: UtilityProcess, callback: (done: number) => void) =>",
            "         addUtilityListener(getUtilityPeer(child, 'autoipc:progress'), 'autoipc:progress', callback, false),",
            "      once: (child: UtilityProcess, callback: (done: number) => void) =>",
            "         addUtilityListener(getUtilityPeer(child, 'autoipc:progress'), 'autoipc:progress', callback, true),",
            "   },",
         ].join("\n"),
      );
   });

   it("does not let the generated names shadow the names of the signature", async () => {
      const output = await render([
         { ...callUtility, params: ["child: string"], returnType: "typeof child" },
         { ...callMain, params: ["callback: string", "child: number"] },
      ]);

      expect(output).toContain("invoke: (_child: UtilityProcess, child: string)");
      expect(output).toContain("callUtilityChild(_child, 'autoipc:indexFile', [child]");
      expect(output).toContain(
         "handle: (_child: UtilityProcess, _callback: (callback: string, child: number)",
      );
   });

   it("reserves the names it declares, only when the schema has utility channels", () => {
      const reserved = (...channels: shared.SimpleChannel[]) =>
         (
            new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels)) as unknown as {
               getReservedNames: () => string[];
            }
         ).getReservedNames();

      for (const name of [
         "IpcUtilityError",
         "UtilityPeer",
         "attachUtility",
         "forkUtility",
         "callUtilityChild",
         "utilityProcess",
         "UtilityProcess",
         "WeakMap",
      ]) {
         expect(reserved(callUtility)).toContain(name);
         expect(reserved(renderer)).not.toContain(name);
      }
   });
});
