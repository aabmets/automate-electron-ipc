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
   ask,
   emit,
   IMPORT,
   invoke,
   main,
   mainPort,
   port,
   preload,
   send,
   stream,
} from "@testutils/serializer-utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("serializer, the page and main", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("imports the package that the config names, in main.ts and in preload.ts", async () => {
      expect(await main([invoke])).toContain(IMPORT);
      expect(await preload([invoke])).toContain(IMPORT);
   });

   it("writes nothing of the serializer when the config does not set one", async () => {
      const outputs = [
         await main([invoke, send, emit, ask, stream, port, mainPort], { serializer: undefined }),
         await preload([invoke, send, emit, ask, stream, port, mainPort], {
            serializer: undefined,
         }),
      ];
      for (const output of outputs) {
         expect(output).not.toMatch(
            /serializ|encodeValue|decodeValue|readArguments|IPC_SERIALIZATION/i,
         );
      }
   });

   it("serializes the arguments and the result of an invoke in the page", async () => {
      const output = await preload([invoke]);

      expect(output).toContain(
         "const result = await ipcRenderer.invoke('autoipc:getIt', encodeValue('getIt', args));",
      );
      expect(output).toContain("return decodeValue('getIt', result.value);");
   });

   it("serializes a send, and a rawErrors invoke which then rejects instead of throwing", async () => {
      const output = await preload([send, invoke], { rawErrors: true });

      expect(output).toContain(
         "send: (...args: any[]) => ipcRenderer.send('autoipc:sendIt', encodeSync('sendIt', args)),",
      );
      expect(output).toContain(
         "invoke: async (...args: any[]) => decodeValue('getIt', await ipcRenderer.invoke('autoipc:getIt', encodeValue('getIt', args))),",
      );
   });

   it("serializes inside the timeout of an invoke", async () => {
      const output = await preload([{ ...invoke, timeoutMs: 500 }]);

      expect(output).toContain(
         "withTimeout('getIt', 500, ipcRenderer.invoke('autoipc:getIt', encodeValue('getIt', args)))",
      );
   });

   it("reads the arguments of an emit and of an ask in the page", async () => {
      const output = await preload([emit, ask]);

      expect(output).toContain(
         "return listenToChannel('autoipc:emitIt', callback, false, (received: any[]) => readArguments('emitIt', received));",
      );
      expect(output).toContain(
         "encodeValue(channel, await handler(...decodeArguments(channel, args)))",
      );
   });

   it("serializes the arguments and the chunks of a stream in the page", async () => {
      const output = await preload([stream]);

      expect(output).toContain("ipcRenderer.invoke(wire, id, encodeValue(channel, args))");
      expect(output).toContain("reader.push(decodeValue(channel, message.value));");
   });

   it("reports a failure in the page as a plain object, since contextBridge drops the fields of an Error", async () => {
      const output = await preload([invoke]);

      expect(output).toContain("name: 'IpcSerializationError'");
      expect(output).toContain("code: 'IPC_SERIALIZATION'");
      expect(output).not.toContain("class IpcSerializationError");
   });

   it("decodes in main only after the sender check", async () => {
      const output = await main([invoke, send]);

      expect(output).toMatch(
         /guard\(event\);\n\s+const decoded = readArguments\('getIt', received\);/,
      );
      expect(output).toMatch(
         /if \(!guard\(event\)\) \{\n\s+return;\n\s+\}\n\s+const decoded = readSentArguments\('sendIt', received\);\n\s+if \(!decoded\) \{\n\s+return;/,
      );
   });

   it("decodes before the schema validates, and validates what was decoded", async () => {
      const output = await main([
         { ...invoke, validate: { name: "args", exported: "args", fromPath: "./validators" } },
      ]);

      expect(output).toContain("const decoded = readArguments('getIt', received);");
      expect(output).toContain("validateArguments(event, 'getIt', args, decoded, false,");
   });

   it("serializes the result of an invoke in main, inside the envelope", async () => {
      const output = await main([invoke]);

      expect(output).toContain("settleInvoke(async () => encodeValue('getIt', await (handler as");
      expect(output).toContain("export class IpcSerializationError extends Error {");
   });

   it("serializes the result itself when the errors are left to Electron", async () => {
      const output = await main([invoke], { rawErrors: true });

      expect(output).not.toContain("settleInvoke");
      expect(output).toMatch(
         /const listener = async \(event: IpcMainInvokeEvent, \.\.\.rest: unknown\[\]\) =>\n\s+encodeValue\('getIt', await \(handler as/,
      );
   });

   it("sends the arguments of an emit as one wire value", async () => {
      const output = await main([emit]);

      expect(output).toContain(
         "resolveSendTarget(target).send('autoipc:emitIt', encodeValue('emitIt', [at]))",
      );
      expect(output).toContain("broadcastMessage('autoipc:emitIt', [encodeValue('emitIt', [at])])");
      expect(output).toContain(
         "sendToSenderFrame(event, 'autoipc:emitIt', [encodeValue('emitIt', [at])])",
      );
   });

   it("serializes what the trigger of an emit sends", async () => {
      const output = await main([{ ...emit, trigger: "focus" }]);

      expect(output).toContain("webContents.send('autoipc:emitIt', encodeValue('emitIt', args));");
   });

   it("serializes the question and reads the answer of an ask in main", async () => {
      const output = await main([ask]);

      expect(output).toContain("destination.send(wire, id, encodeValue(channel, args));");
      expect(output).toContain("outcome = { value: decodeValue(channel, outcome.value) };");
   });

   it("serializes the chunks of a stream in main", async () => {
      const output = await main([stream]);

      expect(output).toContain("value: encodeValue(channel, step.value)");
   });
});
