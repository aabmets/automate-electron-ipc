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

import { renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestMainBindingsWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt, type SimpleChannel } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter, shared event watches", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
   const stream = {
      name: "rows",
      kind: "Stream",
      direction: "RendererToMain",
      returnType: "AsyncIterable<number>",
   } as const;
   const port = { name: "chat", kind: "Port", direction: "RendererToRenderer" } as const;
   const mainPort = { name: "logTail", kind: "Port", direction: "MainToRenderer" } as const;
   const brokered = {
      name: "queryRows",
      kind: "Unicast",
      direction: "RendererToUtility",
      returnType: "Promise<number>",
   } as const;
   const broadcast = { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" } as const;

   const render = (...channels: SimpleChannel[]) => renderWith(VitestMainBindingsWriter, channels);

   it.each([
      ["an ask", [ask]],
      ["a stream", [stream]],
      ["a port", [port]],
      ["a mainPort", [mainPort]],
      ["a brokered channel", [brokered]],
      ["all of them", [ask, stream, port, mainPort, brokered]],
   ])("writes watchEvent once for %s", async (_name, channels) => {
      const output = await render(...channels);

      expect(output.match(/^function watchEvent\(/gm)).toHaveLength(1);
      expect(output).toContain("const eventWatches = new WeakMap<");
      // One listener per event and emitter, and it goes with the last watcher.
      expect(output).toContain("emitter.on(event, watch.listener);");
      expect(output).toContain("emitter.removeListener(event, listener);");
      expect(output.match(/emitter\.on\(/g)).toHaveLength(1);
   });

   it("writes none of it for channels which hold nothing open", async () => {
      const output = await render(getIt, broadcast);

      for (const name of ["watchEvent", "eventWatches", "WatchableEmitter", "WeakMap"]) {
         expect(output).not.toContain(name);
      }
   });

   it("adds no listener to contents, a window or a child outside watchEvent", async () => {
      const strip = (output: string) => output.replace(/^function watchEvent\([\s\S]*?\n}\n/m, "");
      // The stream channel comes with resolveIpcTarget, whose one listener per contents is its own.
      const output = strip(await render(ask, port, mainPort, brokered));
      const withStream = strip(await render(stream));

      expect(output).not.toMatch(/\b(contents|asked|win)\??\.(on|once|off|removeListener)\(/);
      expect(output).not.toMatch(/end\.win\.(on|off)\(/);
      expect(output).not.toMatch(/child\.(once|removeListener)\('exit', close/);
      // The one listener of attachUtility remains.
      expect(output.match(/child\.once\('exit'/g)).toHaveLength(1);
      expect(withStream).not.toMatch(/\bsender\??\.(on|once|off|removeListener)\(/);
   });

   it("reserves its names, and WeakMap, only for such a schema", () => {
      const reserved = (...channels: SimpleChannel[]) =>
         (
            new VitestMainBindingsWriter(buildFileSpecs(...channels)) as unknown as {
               getReservedNames: () => string[];
            }
         ).getReservedNames();

      for (const name of ["watchEvent", "eventWatches", "EventWatch", "WatchableEmitter"]) {
         expect(reserved(ask)).toContain(name);
         expect(reserved(getIt)).toContain(name);
      }
      expect(reserved(ask)).toContain("WeakMap");
      expect(reserved(getIt)).not.toContain("WeakMap");
   });
});
