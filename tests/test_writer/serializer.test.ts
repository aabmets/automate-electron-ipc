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
const mainPort: shared.SimpleChannel = {
   name: "mainPortIt",
   kind: "Port",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
const utility: shared.SimpleChannel = {
   name: "utilityIt",
   kind: "Unicast",
   direction: "MainToUtility",
   params: ["at: Date"],
   returnType: "Promise<void>",
};
const utilityNotify: shared.SimpleChannel = {
   name: "utilityNotify",
   kind: "Broadcast",
   direction: "MainToUtility",
   params: ["at: Date"],
};
const callMain: shared.SimpleChannel = {
   name: "callMain",
   kind: "Unicast",
   direction: "UtilityToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
const brokeredCall: shared.SimpleChannel = {
   name: "brokeredCall",
   kind: "Unicast",
   direction: "RendererToUtility",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
const brokeredStream: shared.SimpleChannel = {
   name: "brokeredStream",
   kind: "Stream",
   direction: "RendererToUtility",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
const worker: shared.SimpleChannel = {
   name: "workerIt",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
const workerSend: shared.SimpleChannel = {
   name: "workerSend",
   kind: "Broadcast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "void",
};
const workerEmit: shared.SimpleChannel = {
   name: "workerEmit",
   kind: "Broadcast",
   direction: "MainToServiceWorker",
   params: ["at: Date"],
   returnType: "void",
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
   mocks.mockGetTargetFilePath(shared.VitestUtilityBindingsWriter);

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
   const utilityFile = async (
      channels: shared.SimpleChannel[],
      extra: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels), {
         ...config,
         ...extra,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const workerPreload = async (
      channels: shared.SimpleChannel[],
      extra: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestServiceWorkerPreloadWriter(shared.buildFileSpecs(...channels), {
         ...config,
         ...extra,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

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

   it("imports the serializer for the worker channels alone, in main.ts and in the script of the worker", async () => {
      for (const channel of [worker, workerSend, workerEmit, workerAsk]) {
         // biome-ignore lint/performance/noAwaitInLoops: the writers of a class share one file
         const output = await main([channel]);
         const script = await workerPreload([channel]);
         const page = await preload([channel]);

         expect(output).toContain(IMPORT);
         expect(output).toContain("export class IpcSerializationError extends Error {");
         expect(script).toContain(IMPORT);
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
      expect(output).toContain("const args = readArguments('workerEmit', received);");
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

   it("posts a message of a port channel in the page as a list of the serialized arguments", async () => {
      const output = await preload([port]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("port.postMessage([encodeSync(channel, args)]);");
      expect(output).toContain("next.postMessage([encodeValue(channel, args)]);");
      expect(output).toContain(
         "const args = Array.isArray(event.data) ? readArguments(channel, event.data) : undefined;",
      );
      expect(output).toContain("notify(subscribers, args);");
      expect(output).not.toContain("notify(subscribers, event.data);");
   });

   it("serializes the messages of a main port channel in the page as well", async () => {
      const output = await preload([mainPort]);

      expect(output).toContain("port.postMessage([encodeSync(channel, args)]);");
      expect(output).toContain("readArguments(channel, event.data)");
   });

   it("serializes the messages of a main port channel in main", async () => {
      const output = await main([mainPort]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("port.postMessage([encodeValue(name, args)]);");
      expect(output).toContain("next.postMessage([encodeValue(name, args)]);");
      expect(output).toContain("const args = readSentArguments(name, event.data);");
      expect(output).toContain("notifyMainPortListeners(subscribers, args);");
      expect(output).toContain("export class IpcSerializationError extends Error {");
   });

   it("serializes a port channel only where the messages are seen: the pages, not the main process that pairs them", async () => {
      const output = await main([port]);

      expect(output).not.toContain("ipcSerialize");
      expect(output).not.toContain("encodeValue");
      expect(output).not.toContain("IpcSerializationError");
   });

   it("serializes the channels of a page and of a worker of the same schema", async () => {
      const output = await main([invoke, worker]);

      expect(output).toContain(IMPORT);
      expect(output).toContain("encodeValue('getIt'");
      expect(output).toContain("encodeValue(info.channel, await");
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
      // A module script does not resolve without its extension, under any module resolution.
      expect(ig.getFileImportPath("/p/src/autoipc/util/wire.mts")).toBe("./util/wire.mjs");
      expect(ig.getFileImportPath("/p/src/autoipc/util/wire.cts")).toBe("./util/wire.cjs");
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
