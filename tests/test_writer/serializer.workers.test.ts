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
   main,
   preload,
   worker,
   workerAsk,
   workerEmit,
   workerPreload,
   workerSend,
} from "@testutils/writer/serializer-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import {
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestServiceWorkerPreloadWriter,
} from "@testutils/writer/test-writers.js";
import { describe, expect, it } from "vitest";

const SERIALIZER_IMPORT = /^import \{ [^}]*ipc(De)?[sS]erialize[^}]* \} from "superjson";$/m;

describe("serializer, service workers", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);
   mockGetTargetFilePath(VitestPreloadBindingsWriter);
   mockGetTargetFilePath(VitestServiceWorkerPreloadWriter);

   it("imports the serializer for the worker channels alone, in main.ts and in the script of the worker", async () => {
      for (const channel of [worker, workerSend, workerEmit, workerAsk]) {
         // biome-ignore lint/performance/noAwaitInLoops: the writers of a class share one file
         const output = await main([channel]);
         const script = await workerPreload([channel]);
         const page = await preload([channel]);

         // Only the names that the channel calls stay in the import (T173).
         expect(output).toMatch(SERIALIZER_IMPORT);
         expect(output).toContain("export class IpcSerializationError extends Error {");
         expect(script).toMatch(SERIALIZER_IMPORT);
         // The page has nothing to do with the channels of a worker.
         expect(page).not.toContain("ipcSerialize");
      }
   });

   it("decodes the arguments of a call of a worker after the sender check, and encodes the result", async () => {
      const output = await main([worker]);

      expect(output).toContain("return handler(event, ...readArguments(info.channel, args));");
      expect(output.indexOf("isWorkerAllowed(worker, event, info.channel")).toBeLessThan(
         output.indexOf("readArguments(info.channel, args)"),
      );
      expect(output).toContain("encodeValue(info.channel, await callWorkerHandler(");
   });

   it("encodes the result of a call of a worker without the envelope, in an async handler", async () => {
      const output = await main([worker], { rawErrors: true });

      expect(output).toMatch(
         /worker\.ipc\.handle\(info\.wire, async \(event: IpcMainServiceWorkerInvokeEvent, \.\.\.args: unknown\[\]\) =>\n\s+encodeValue\(info\.channel, await callWorkerHandler/,
      );
   });

   it("reads the message of a worker once, and drops it with a log when it cannot be read", async () => {
      const output = await main([workerSend]);

      expect(output).toContain("const decoded = readSentArguments(info.channel, args);");
      expect(output).toContain(
         "(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...decoded);",
      );
      // The listeners are looked up first, so a message nobody listens to is not read.
      expect(output.indexOf("hub.listeners[info.channel]")).toBeLessThan(
         output.indexOf("readSentArguments(info.channel, args)"),
      );
   });

   it("sends a message to a worker as one value, and encodes the question and reads the answer", async () => {
      const output = await main([workerEmit, workerAsk]);

      expect(output).toContain(
         "sendToWorker('workerEmit', 'autoipc:workerEmit', worker, [encodeValue('workerEmit', [at])])",
      );
      expect(output).toContain(
         "broadcastToWorkers('autoipc:workerEmit', session, [encodeValue('workerEmit', [at])])",
      );
      expect(output).toContain("const question = encodeValue(channel, args);");
      // The question is serialized once, by the helper, so that a failure rejects the promise.
      expect(output).toContain(
         "askServiceWorker('workerAsk', 'autoipc:workerAsk', worker, [zone])",
      );
      expect(output).toContain("worker.send(wire, id, question);");
      expect(output).toContain("outcome = { value: decodeValue(channel, outcome.value) };");
   });

   it("writes the script of a worker like that of a page, with the serializer", async () => {
      const output = await workerPreload([worker, workerSend, workerEmit, workerAsk]);

      expect(output).toContain(
         "const result = await ipcRenderer.invoke('autoipc:workerIt', encodeValue('workerIt', args));",
      );
      expect(output).toContain("return decodeValue('workerIt', result.value);");
      expect(output).toContain(
         "ipcRenderer.send('autoipc:workerSend', encodeSync('workerSend', args))",
      );
      expect(output).toContain(
         "return listenToChannel('autoipc:workerEmit', callback, false, (received: any[]) => readArguments('workerEmit', received));",
      );
      expect(output).toContain(
         "encodeValue(channel, await handler(...decodeArguments(channel, args)))",
      );
   });

   it("writes nothing of the serializer for the worker channels when the config sets none", async () => {
      const files = [
         await main([worker, workerSend, workerEmit, workerAsk], { serializer: undefined }),
         await workerPreload([worker, workerSend, workerEmit, workerAsk], {
            serializer: undefined,
         }),
      ];
      for (const output of files) {
         expect(output).not.toMatch(
            /serializ|encodeValue|decodeValue|readArguments|IPC_SERIALIZATION/i,
         );
      }
      expect(files[1]).toContain("ipcRenderer.invoke('autoipc:workerIt', ...args)");
   });
});
