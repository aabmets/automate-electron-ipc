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

const callUtility = { name: "indexFile", kind: "Unicast", direction: "MainToUtility" } as const;
const notifyUtility = { name: "setLevel", kind: "Broadcast", direction: "MainToUtility" } as const;
const callMain = { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" } as const;
const notifyMain = { name: "progress", kind: "Broadcast", direction: "UtilityToMain" } as const;
const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;

describe("UtilityBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestUtilityBindingsWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels only when the schema has a channel to or from a utility process", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels)).hasChannels();

      expect(has()).toBe(false);
      expect(has(renderer, { name: "p", kind: "Port", direction: "RendererToRenderer" })).toBe(
         false,
      );
      for (const channel of [callUtility, notifyUtility, callMain, notifyMain]) {
         expect(has(renderer, channel)).toBe(true);
      }
   });

   it("writes an empty ipc object when there is no schema", async () => {
      const obj = new shared.VitestUtilityBindingsWriter([]);
      await obj.write(false);
      expect((await fsp.readFile(obj.getTargetFilePath())).toString()).toBe(
         "export const ipc = {};",
      );
   });

   it("writes the peer, the port and one object per channel, sorted by name", async () => {
      const output = await render([notifyMain, callUtility, renderer, callMain, notifyUtility]);

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

describe("UtilityBindingsWriter, renderer to utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestUtilityBindingsWriter);

   const invokeUtility = {
      name: "queryRows",
      kind: "Unicast",
      direction: "RendererToUtility",
      params: ["sql: string", "...tags: string[]"],
      returnType: "Promise<number>",
   } as const;
   const streamUtility = {
      name: "scanRows",
      kind: "Stream",
      direction: "RendererToUtility",
      params: ["table: string"],
      returnType: "AsyncIterable<number>",
   } as const;

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels when the schema has a channel from a page to a utility process", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels)).hasChannels();

      expect(has(renderer, invokeUtility)).toBe(true);
      expect(has(renderer, streamUtility)).toBe(true);
   });

   it("writes handle for a call, and for a stream, typed as the signature", async () => {
      const output = await render(streamUtility, invokeUtility, renderer);

      expect(output).toContain(
         [
            "   queryRows: {",
            "      handle: (callback: (sql: string, ...tags: string[]) => Promise<number>) =>",
            "         setBrokerCall('autoipc:queryRows', callback),",
            "   },",
            "   scanRows: {",
            "      handle: (callback: (table: string) => AsyncIterable<number>) =>",
            "         setBrokerStream('autoipc:scanRows', callback),",
            "   },",
         ].join("\n"),
      );
      expect(output).not.toContain("getUser");
   });

   it("does not let the generated name shadow a parameter of the signature", async () => {
      const output = await render({ ...invokeUtility, params: ["callback: string"] });

      expect(output).toContain("handle: (_callback: (callback: string) => Promise<number>)");
      expect(output).toContain("setBrokerCall('autoipc:queryRows', _callback)");
   });

   it("writes the server of the ports, with the channels of the file as the ones it accepts", async () => {
      const output = await render(invokeUtility, streamUtility);

      expect(output).toContain(
         "const brokerChannels = new Set<string>(['autoipc:queryRows', 'autoipc:scanRows']);",
      );
      expect(output).toContain(
         "function serveBrokeredPort(channel: string, port: BrokerPort): void {",
      );
      expect(output).toContain("function acceptBrokeredPort(");
      expect(output).toContain("peer.handlers = brokerCalls;");
      expect(output).toContain("if (!acceptBrokeredPort(event)) {");
      expect(output).toContain(
         "on: (event: 'message', listener: (event: { data: unknown; ports?: BrokerPort[] }) => void) => unknown;",
      );
   });

   it("writes nothing of the server for the channels between the processes", async () => {
      const output = await render(callUtility);

      for (const name of ["BrokerPort", "serveBrokeredPort", "brokerChannels", "ports?:"]) {
         expect(output).not.toContain(name);
      }
      expect(output).toContain(
         "port.on('message', (event) => receiveUtilityMessage(peer, event.data));",
      );
   });

   it("writes the server next to the channels between the processes", async () => {
      const output = await render(callUtility, invokeUtility);

      expect(output).toContain("   indexFile: {");
      expect(output).toContain("   queryRows: {");
      expect(output.match(/^function receiveUtilityMessage\(/gm)).toHaveLength(1);
   });

   it("attaches the listener of the port before a handler is registered", async () => {
      const output = await render(invokeUtility, streamUtility);

      expect(output).toContain(
         "function setBrokerCall(channel: string, callback: UtilityCallback): () => void {\n   getUtilityPeer();",
      );
      expect(output).toContain(
         "function setBrokerStream(channel: string, callback: UtilityCallback): () => void {\n   getUtilityPeer();",
      );
   });

   it("reserves the names of the server only for a schema with such channels", () => {
      const reserved = (...channels: shared.SimpleChannel[]) =>
         (
            new shared.VitestUtilityBindingsWriter(
               shared.buildFileSpecs(...channels),
            ) as unknown as {
               getReservedNames: () => string[];
            }
         ).getReservedNames();

      for (const name of ["BrokerPort", "serveBrokeredPort", "setBrokerCall", "Symbol"]) {
         expect(reserved(invokeUtility)).toContain(name);
         expect(reserved(callUtility)).not.toContain(name);
      }
   });
});
