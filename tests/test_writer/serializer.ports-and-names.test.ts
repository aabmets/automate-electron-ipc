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
   config,
   emit,
   IMPORT,
   invoke,
   main,
   mainPort,
   port,
   preload,
   stream,
   worker,
} from "@testutils/writer/serializer-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import {
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
} from "@testutils/writer/test-writers.js";
import { buildFileSpecs } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("serializer, ports and reserved names", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);
   mockGetTargetFilePath(VitestPreloadBindingsWriter);

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
      const obj = new VitestMainBindingsWriter(buildFileSpecs(invoke), config);
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
      const off = new VitestMainBindingsWriter(buildFileSpecs(invoke), {});
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
