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
import { callUtility, renderer } from "@testutils/writer/utility-writer-utils.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

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

   it("gives the server the window of every stream channel, sorted by the wire name", async () => {
      const windowed = { ...streamUtility, name: "windowed", highWaterMark: 4 };
      const unbounded = { ...streamUtility, name: "aaa", highWaterMark: Number.POSITIVE_INFINITY };
      const output = await render(invokeUtility, windowed, streamUtility, unbounded);

      expect(output).toContain(
         "const brokerWindows = new Map<string, number>([['autoipc:aaa', Infinity], ['autoipc:scanRows', 1024], ['autoipc:windowed', 4]]);",
      );
   });

   it("pauses the pump at the limit of the call, before it asks the generator for a chunk", async () => {
      const output = await render(streamUtility);

      expect(output).toContain("limit: brokerWindows.get(channel) ?? 0");
      expect(output).toContain("if (sent >= entry.limit) {");
      expect(output).toContain("source.__ipc === 'credit' && typeof source.id === 'number'");
      expect(output).toContain("sent += 1;");
      expect(output.indexOf("if (sent >= entry.limit) {")).toBeLessThan(
         output.indexOf("step = await iterator.next();"),
      );
      // A cancel and the close of the port wake a paused pump.
      expect(output.match(/entry\.wake\?\.\(\);/g)).toHaveLength(3);
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

      for (const name of [
         "BrokerPort",
         "serveBrokeredPort",
         "setBrokerCall",
         "brokerWindows",
         "Symbol",
      ]) {
         expect(reserved(invokeUtility)).toContain(name);
         expect(reserved(callUtility)).not.toContain(name);
      }
   });
});
