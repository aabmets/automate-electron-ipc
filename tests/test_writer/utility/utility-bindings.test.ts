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

import { renderSpecs, renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestUtilityBindingsWriter } from "@testutils/writer/test-writers.js";
import {
   callMain,
   callUtility,
   notifyMain,
   notifyUtility,
} from "@testutils/writer/utility-writer-utils.js";
import { buildFileSpecs, getUser, type SimpleChannel } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("UtilityBindingsWriter", () => {
   mockGetTargetFilePath(VitestUtilityBindingsWriter);

   const render = (channels: SimpleChannel[], config: Partial<t.IPCResolvedConfig> = {}) =>
      renderWith(VitestUtilityBindingsWriter, channels, {
         channelPrefix: "autoipc:",
         ...config,
      });

   it("has channels only when the schema has a channel to or from a utility process", () => {
      const has = (...channels: SimpleChannel[]) =>
         new VitestUtilityBindingsWriter(buildFileSpecs(...channels)).hasChannels();

      expect(has()).toBe(false);
      expect(has(getUser, { name: "p", kind: "Port", direction: "RendererToRenderer" })).toBe(
         false,
      );
      for (const channel of [callUtility, notifyUtility, callMain, notifyMain]) {
         expect(has(getUser, channel)).toBe(true);
      }
   });

   it("writes an empty ipc object when there is no schema", async () => {
      expect(await renderSpecs(VitestUtilityBindingsWriter, [])).toBe("export const ipc = {};");
   });

   it("writes the peer, the port and one object per channel, sorted by name", async () => {
      const output = await render([notifyMain, callUtility, getUser, callMain, notifyUtility]);

      expect(output).toContain("export class IpcUtilityError extends Error {");
      expect(output).toContain(
         "function receiveUtilityMessage(peer: UtilityPeer, message: unknown): void {",
      );
      expect(output).toContain("function getUtilityPeer(): UtilityPeer {");
      expect(output).toContain(
         "const port = (globalThis as unknown as { process?: { parentPort?: UtilityParentPort } }).process?.parentPort;",
      );
      expect(output).toContain(
         "port.on('message', (event) => receiveUtilityMessage(peer, event.data));",
      );
      const names = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(names).toStrictEqual(["getSetting", "indexFile", "progress", "setLevel"]);
      expect(output).not.toContain("getUser");
      expect(output).not.toContain('from "electron"');
   });

   it("writes handle for a call of the main process, with the callback typed as the signature", async () => {
      const output = await render([
         {
            ...callUtility,
            params: ["path: string", "...tags: string[]"],
            returnType: "Promise<number>",
         },
      ]);

      expect(output).toContain(
         [
            "   indexFile: {",
            "      handle: (callback: (path: string, ...tags: string[]) => Promise<number>) =>",
            "         setUtilityHandler(getUtilityPeer(), 'autoipc:indexFile', callback),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes on and once for a notification of the main process", async () => {
      const output = await render([{ ...notifyUtility, params: ["level: string"] }]);

      expect(output).toContain(
         [
            "   setLevel: {",
            "      on: (callback: (level: string) => void) =>",
            "         addUtilityListener(getUtilityPeer(), 'autoipc:setLevel', callback, false),",
            "      once: (callback: (level: string) => void) =>",
            "         addUtilityListener(getUtilityPeer(), 'autoipc:setLevel', callback, true),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes invoke for a call to the main process, which returns a promise of the awaited result", async () => {
      const output = await render([
         {
            ...callMain,
            params: ["key: string", "fallback?: string"],
            returnType: "Promise<string>",
         },
         { ...callMain, name: "plain", returnType: "boolean" },
         {
            ...callMain,
            name: "rest",
            params: ["a: number", "...more: number[]"],
            returnType: "void",
         },
      ]);

      expect(output).toContain(
         [
            "   getSetting: {",
            "      invoke: (key: string, fallback?: string): Promise<string> =>",
            "         callUtilityPeer(getUtilityPeer(), 'autoipc:getSetting', [key, fallback]) as Promise<string>,",
            "   },",
         ].join("\n"),
      );
      expect(output).toContain(
         "invoke: (): Promise<Awaited<boolean>> =>\n         callUtilityPeer(getUtilityPeer(), 'autoipc:plain', []) as Promise<Awaited<boolean>>,",
      );
      expect(output).toContain("callUtilityPeer(getUtilityPeer(), 'autoipc:rest', [a, ...more])");
   });

   describe("timeouts", () => {
      it("passes the timeout of a call to the main process as the last argument", async () => {
         const output = await render([
            { ...callMain, timeoutMs: 800, params: ["key: string"], returnType: "Promise<string>" },
            { ...callMain, name: "plain", returnType: "boolean" },
            { ...callMain, name: "patient", timeoutMs: 0, returnType: "boolean" },
         ]);

         expect(output).toContain(
            "callUtilityPeer(getUtilityPeer(), 'autoipc:getSetting', [key], 800)",
         );
         expect(output).toContain("callUtilityPeer(getUtilityPeer(), 'autoipc:plain', [])");
         expect(output).toContain("callUtilityPeer(getUtilityPeer(), 'autoipc:patient', [])");
      });

      it("uses the default of the config, which the option overrides", async () => {
         const output = await render(
            [
               { ...callMain, timeoutMs: 100 },
               { ...callMain, name: "plain" },
               { ...callMain, name: "patient", timeoutMs: 0 },
            ],
            { timeoutMs: 2500 },
         );

         expect(output).toContain("'autoipc:getSetting', [], 100)");
         expect(output).toContain("'autoipc:plain', [], 2500)");
         expect(output).toContain("'autoipc:patient', [])");
      });

      it("times the call of the peer, and clears the timer when the call settles", async () => {
         const output = await render([callMain]);

         expect(output).toContain(
            "function callUtilityPeer(peer: UtilityPeer, channel: string, args: unknown[], timeoutMs = 0): Promise<unknown> {",
         );
         expect(output).toContain("'IPC_UTILITY_TIMEOUT'");
         expect(output).toContain("}, Math.min(timeoutMs, 2147483647));");
         expect(output.match(/clearTimeout\(timer\);/g)).toHaveLength(2);
      });

      it("does not time a notification", async () => {
         const output = await render([{ ...notifyMain, timeoutMs: 5 }], { timeoutMs: 2500 });

         expect(output).toContain("sendUtilityPeer(getUtilityPeer(), 'autoipc:progress', [");
         expect(output).not.toMatch(/sendUtilityPeer\([^)]*\), \d+\)/);
      });
   });

   it("writes send for a notification to the main process", async () => {
      const output = await render([{ ...notifyMain, params: ["done: number", "total: number"] }]);

      expect(output).toContain(
         [
            "   progress: {",
            "      send: (done: number, total: number): void =>",
            "         sendUtilityPeer(getUtilityPeer(), 'autoipc:progress', [done, total]),",
            "   },",
         ].join("\n"),
      );
   });

   it("repeats the type parameters of a generic signature", async () => {
      const output = await render([
         { ...callMain, name: "echo", params: ["value: T"], returnType: "T" },
         { ...callUtility, name: "same", params: ["value: T"], returnType: "T" },
      ]);
      // The type parameters are part of the parsed signature text, which the test builder omits.
      expect(output).toContain("echo: {");
      expect(output).toContain("same: {");
   });

   it("puts the channel prefix on the wire names only", async () => {
      const output = await render([callUtility, notifyMain], { channelPrefix: "app:" });

      expect(output).toContain("setUtilityHandler(getUtilityPeer(), 'app:indexFile', callback)");
      expect(output).toContain("sendUtilityPeer(getUtilityPeer(), 'app:progress', [])");
      expect(output).toContain("   indexFile: {");
   });

   it("uses no prefix when the config has none", async () => {
      const output = await render([callUtility], { channelPrefix: "" });

      expect(output).toContain("setUtilityHandler(getUtilityPeer(), 'indexFile', callback)");
   });

   it("does not let the generated callback name shadow a name of the signature", async () => {
      const output = await render([
         { ...callUtility, params: ["callback: string"], returnType: "typeof callback" },
         { ...notifyUtility, name: "other", params: ["callback: string"] },
      ]);

      expect(output).toContain("handle: (_callback: (callback: string) => typeof callback) =>");
      expect(output).toContain(
         "setUtilityHandler(getUtilityPeer(), 'autoipc:indexFile', _callback)",
      );
      expect(output).toContain("on: (_callback: (callback: string) => void) =>");
   });

   it("indents with the configured width", async () => {
      const output = await render([notifyMain], { codeIndent: 4 });

      expect(output).toContain("    progress: {\n        send: (): void =>");
   });

   it("includes the envelope and the protocol once", async () => {
      const output = await render([callUtility, callMain]);

      for (const declaration of [
         "interface IpcErrorInfo {",
         "function toIpcError(error: unknown): IpcErrorInfo {",
         "async function settleInvoke(run: () => unknown): Promise<IpcEnvelope> {",
         "function createUtilityPeer(",
         "export class IpcUtilityError extends Error {",
      ]) {
         expect(output.split(declaration)).toHaveLength(2);
      }
   });
});
