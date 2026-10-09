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

import {
   brokeredCall,
   brokeredStream,
   callMain,
   config,
   IMPORT,
   main,
   preload,
   utility,
   utilityFile,
   utilityNotify,
} from "@testutils/serializer-utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("serializer, utility processes", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);
   mocks.mockGetTargetFilePath(shared.VitestUtilityBindingsWriter);

   it("serializes the calls and the sends between main and a utility process, in the peer code of main", async () => {
      const output = await main([utility, utilityNotify, callMain]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("export class IpcSerializationError extends Error {");
      // A call posts the arguments as a list of one value, and reads the value of the reply.
      expect(output).toContain("wired = [encodeValue(channel, args)];");
      expect(output).toContain("peer.post({ __ipc: 'call', channel, id, args: wired });");
      expect(output).toContain("call.resolve(decodeValue(channel, outcome.value));");
      // A send is serialized in the same way, and one that arrives is read, or logged and dropped.
      expect(output).toContain("peer.post({ __ipc: 'send', channel, args: wired });");
      expect(output).toContain("const args = readSentArguments(channel, source.args);");
      // A call that arrives is read inside the envelope, and so is the result.
      expect(output).toContain(
         "return encodeValue(channel, await handler(...readArguments(channel, args)));",
      );
   });

   it("leaves the peer code without the serializer when the config names none", async () => {
      const output = await main([utility, utilityNotify, callMain], { serializer: undefined });

      expect(output).not.toMatch(/encodeValue|decodeValue|readArguments|IpcSerializationError/);
      expect(output).toContain("peer.post({ __ipc: 'call', channel, id, args });");
      expect(output).toContain("peer.post({ __ipc: 'send', channel, args });");
   });

   it("does not serialize the channels of a page and a utility process in main, which only brokers the port", async () => {
      const output = await main([brokeredCall, brokeredStream]);

      expect(output).not.toContain("ipcSerialize");
      expect(output).not.toContain("encodeValue");
      expect(output).not.toContain("IpcSerializationError");
   });

   it("keeps the peers of the children, which brokered channels need for the exit of a child, free of the serializer", async () => {
      const output = await main([brokeredCall, brokeredStream]);

      expect(output).toContain("export function forkUtility(");
      expect(output).toContain("call.resolve(outcome.value);");
      expect(output).not.toContain("decodeValue");
      expect(output).not.toContain("readSentArguments");
   });

   it("serializes the channels with a utility process in the utility file, with the import of the config", async () => {
      const output = await utilityFile([utility, utilityNotify, callMain]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("export class IpcSerializationError extends Error {");
      expect(output).toContain("peer.post({ __ipc: 'call', channel, id, args: wired });");
      expect(output).toContain("peer.post({ __ipc: 'send', channel, args: wired });");
      expect(output).toContain("const args = readSentArguments(channel, source.args);");
   });

   it("serializes the arguments and the chunks of the brokered channels in the utility file", async () => {
      const output = await utilityFile([brokeredCall, brokeredStream]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("await handler(...readArguments(channel, args))");
      expect(output).toContain("value: encodeValue(channel, step.value)");
      expect(output).toContain("fail(error instanceof IpcSerializationError ? error : {");
      expect(output).toContain(
         "return encodeValue(channel, await handler(...readArguments(channel, args)));",
      );
   });

   it("leaves the utility file without the serializer when the config names none", async () => {
      const output = await utilityFile([brokeredCall, brokeredStream, utility], {
         serializer: undefined,
      });

      expect(output).not.toMatch(/ipcSerialize|encodeValue|decodeValue|readArguments|Serializ/);
      expect(output).toContain("await handler(...args)");
      expect(output).toContain("value: step.value");
   });

   it("serializes the calls of the page to a utility process in the preload script", async () => {
      const output = await preload([brokeredCall, brokeredStream]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("wired = [encodeValue(client.name, args)];");
      expect(output).toContain("args: wired });");
      expect(output).toContain("call.resolve(decodeValue(client.name, envelope.value));");
      expect(output).toContain("stream.push(decodeValue(client.name, source.value));");
      // A chunk that cannot be read stops the stream in the child as well.
      expect(output).toMatch(/catch \(error\) \{\n\s+\/\/ The stream cannot go on/);
   });

   it("leaves the preload script without the serializer for the traffic of main and a utility process", async () => {
      const output = await preload([utility, utilityNotify, callMain]);

      expect(output).not.toContain("ipcSerialize");
      expect(output).not.toContain("encodeValue");
   });

   it("reserves the names of the serializer in the utility file", () => {
      const obj = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(utility), config);
      const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

      for (const name of [
         "ipcSerialize",
         "IpcSerializationError",
         "encodeValue",
         "readArguments",
      ]) {
         expect(names).toContain(name);
      }
      const off = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(utility), {});
      expect((off as unknown as { getReservedNames(): string[] }).getReservedNames()).not.toContain(
         "encodeValue",
      );
   });
});
