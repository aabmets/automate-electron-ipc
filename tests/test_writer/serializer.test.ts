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
import { ImportsGenerator } from "@src/writer/imports-generator.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

const IMPORT =
   'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "superjson";';

const invoke: shared.SimpleChannel = {
   name: "getIt",
   kind: "Unicast",
   direction: "RendererToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
const send: shared.SimpleChannel = {
   name: "sendIt",
   kind: "Broadcast",
   direction: "RendererToMain",
   params: ["at: Date"],
};
const emit: shared.SimpleChannel = {
   name: "emitIt",
   kind: "Broadcast",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
const ask: shared.SimpleChannel = {
   name: "askIt",
   kind: "Unicast",
   direction: "MainToRenderer",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};
const stream: shared.SimpleChannel = {
   name: "streamIt",
   kind: "Stream",
   direction: "RendererToMain",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
const port: shared.SimpleChannel = {
   name: "portIt",
   kind: "Port",
   direction: "RendererToRenderer",
   params: ["at: Date"],
};
const utility: shared.SimpleChannel = {
   name: "utilityIt",
   kind: "Unicast",
   direction: "MainToUtility",
   params: ["at: Date"],
   returnType: "Promise<void>",
};
const worker: shared.SimpleChannel = {
   name: "workerIt",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
const workerAsk: shared.SimpleChannel = {
   name: "workerAsk",
   kind: "Unicast",
   direction: "MainToServiceWorker",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};

describe("serializer, the generated files", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);
   mocks.mockGetTargetFilePath(shared.VitestServiceWorkerPreloadWriter);

   const config = { serializer: "superjson", channelPrefix: "autoipc:" };
   const main = async (
      channels: shared.SimpleChannel[],
      extra: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
         ...config,
         ...extra,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const preload = async (
      channels: shared.SimpleChannel[],
      extra: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels), {
         ...config,
         ...extra,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const workerPreload = async (channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestServiceWorkerPreloadWriter(
         shared.buildFileSpecs(...channels),
         config,
      );
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("imports the package that the config names, in main.ts and in preload.ts", async () => {
      expect(await main([invoke])).toContain(IMPORT);
      expect(await preload([invoke])).toContain(IMPORT);
   });

   it("writes nothing of the serializer when the config does not set one", async () => {
      const outputs = [
         await main([invoke, send, emit, ask, stream], { serializer: undefined }),
         await preload([invoke, send, emit, ask, stream], { serializer: undefined }),
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
         "send: (...args: any[]) => ipcRenderer.send('autoipc:sendIt', encodeValue('sendIt', args)),",
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

      expect(output).toContain("const args = readArguments('emitIt', received);");
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

   it("leaves the ports, the utility channels and the worker channels out", async () => {
      for (const channel of [port, utility, worker, workerAsk]) {
         // biome-ignore lint/performance/noAwaitInLoops: the writers of a class share one file
         const output = await main([channel]);
         const page = await preload([channel]);

         expect(output).not.toContain("ipcSerialize");
         expect(output).not.toContain("encodeValue");
         expect(page).not.toContain("ipcSerialize");
      }
   });

   it("serializes the channels of the page and leaves the others of the same schema alone", async () => {
      const output = await main([invoke, port, utility, worker]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("encodeValue('getIt'");
      expect(output).not.toMatch(/(?:encode|decode)Value\('(?:portIt|utilityIt|workerIt)'/);
   });

   it("writes the preload script of a service worker without the serializer", async () => {
      const output = await workerPreload([worker, workerAsk]);

      expect(output).toContain("ipcRenderer.invoke('autoipc:workerIt', ...args)");
      expect(output).not.toMatch(/serializ|encodeValue|decodeValue|readArguments/i);
   });

   it("reserves the names of the serializer, so that a schema type is renamed", () => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(invoke), config);
      const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

      for (const name of [
         "ipcSerialize",
         "ipcDeserialize",
         "IpcSerializationError",
         "encodeValue",
         "decodeValue",
         "readArguments",
         "readSentArguments",
      ]) {
         expect(names).toContain(name);
      }
      const off = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(invoke), {});
      expect((off as unknown as { getReservedNames(): string[] }).getReservedNames()).not.toContain(
         "encodeValue",
      );
   });

   it("has no dependency on this library at runtime", async () => {
      const outputs = [
         await main([invoke, emit, ask, stream]),
         await preload([invoke, emit, ask, stream]),
      ];
      for (const output of outputs) {
         expect(output).not.toContain("automate-electron-ipc");
      }
   });
});

describe("ImportsGenerator, getFileImportPath", () => {
   it("writes the path of a file in the project relative to the generated file", () => {
      const ig = new ImportsGenerator(false, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/autoipc/serializer.ts")).toBe("./serializer");
      expect(ig.getFileImportPath("/p/src/lib/serializer.ts")).toBe("../lib/serializer");
      expect(ig.getFileImportPath("/p/src/autoipc/util/wire.mts")).toBe("./util/wire");
   });

   it("keeps dots that belong to the name of the file", () => {
      const ig = new ImportsGenerator(false, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/autoipc/wire.codec.ts")).toBe("./wire.codec");
   });

   it("writes the extension of the compiled file with NodeNext", () => {
      const ig = new ImportsGenerator(true, "/p/src/autoipc/main.ts");

      expect(ig.getFileImportPath("/p/src/lib/serializer.ts")).toBe("../lib/serializer.js");
      expect(ig.getFileImportPath("/p/src/lib/serializer.mts")).toBe("../lib/serializer.mjs");
      expect(ig.getFileImportPath("/p/src/lib/serializer")).toBe("../lib/serializer.js");
   });
});
