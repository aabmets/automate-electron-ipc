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

import { callablePaths, windowIpcPaths } from "@testutils/e2e/runtime-utils.js";
import { cleanupStreams, currentProject } from "@testutils/e2e/stream-main-utils.js";
import { loadPreload } from "@testutils/e2e/stream-preload-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanupStreams);

describe("stream, preload script, the API of the page", () => {
   it("exposes stream for every stream channel, and nothing else for it", async () => {
      const { api } = await loadPreload();

      expect(Object.keys(api.exportRows)).toStrictEqual(["stream"]);
      expect(callablePaths(api)).toContain("tokens.stream");
      expect(callablePaths(api)).toContain("getUser.invoke");
      expect(callablePaths(api)).toContain("notice.on");
   });

   it("matches the members of window.d.ts", async () => {
      const { api } = await loadPreload();

      expect(callablePaths(api)).toStrictEqual(
         windowIpcPaths(currentProject()?.generated["window.d.ts"] ?? ""),
      );
   });

   it("returns a stream with next, return, cancel and an async iterator which is itself", async () => {
      const { api } = await loadPreload();
      const stream = api.counter.stream();

      expect(Object.keys(stream).sort()).toStrictEqual(["cancel", "next", "return"]);
      expect(stream[Symbol.asyncIterator]()).toBe(stream);
   });

   it("calls the main process with a new ID and the arguments of the call", async () => {
      const { api, invoke } = await loadPreload();

      api.exportRows.stream("people", 3);
      api.exportRows.stream("orders");
      api.progress.stream("job", true, false);

      expect(invoke.mock.calls).toStrictEqual([
         [wire("exportRows"), 1, "people", 3],
         [wire("exportRows"), 2, "orders"],
         [wire("progress"), 3, "job", true, false],
      ]);
   });
});

describe("window.d.ts of stream channels", () => {
   it("declares IpcStream and the stream method of every channel", async () => {
      const project = await fixtures.run("stream-channels");
      const types = project.generated["window.d.ts"];

      expect(types).toContain("interface IpcStream<T> {");
      expect(types).toContain("stream: (table: string, limit?: number) => IpcStream<Row>;");
      expect(types).toContain("stream: (prompt: string) => IpcStream<string>;");
      expect(types).toContain("stream: () => IpcStream<number>;");
      expect(types).toContain("stream: (job: string, ...flags: boolean[]) => IpcStream<Progress>;");
      expect(types).toContain("stream: <T>(seed: T) => IpcStream<T>;");
      expect(types).toContain("stream: (count: number) => IpcStream<number>;");
      expect(types).toContain("@throws {IpcError<NotFoundError>}");
      expect(types).toContain('import type { NotFoundError } from "./schema";');
   });

   it("type-checks the generated files and a program which uses them", async () => {
      const project = await fixtures.run("stream-channels");

      expect(await project.typecheck()).toBe("");
   });

   it("declares nothing of streams for a schema without them", async () => {
      const project = await fixtures.run("ask-channels");

      expect(project.generated["window.d.ts"]).not.toContain("IpcStream");
      expect(project.generated["preload.ts"]).not.toContain("openStream");
      expect(project.generated["main.ts"]).not.toContain("startStream");
      expect(project.generated["main.ts"]).not.toContain("MessageChannelMain");
   });
});
