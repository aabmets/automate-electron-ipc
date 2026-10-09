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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import {
   callablePaths,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/e2e/runtime-utils.js";
import { cleanupUtilityPorts, loadMain } from "@testutils/e2e/utility-port-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
   cleanupUtilityPorts();
});

describe("utility ports, files", () => {
   it("type-checks main.ts, utility.ts, the preload script and window.d.ts, and the code which uses them", async () => {
      const project = await fixtures.run("utility-ports");
      expect(await project.typecheck()).toBe("");
   });

   it("type-checks a schema which has only a channel from a page to a utility process", async () => {
      const project = await fixtures.run("utility-ports-only");
      expect(await project.typecheck()).toBe("");
      expect(project.generated["utility.ts"]).toContain("setBrokerCall(");
      expect(project.generated["main.ts"]).toContain("function connectUtilityPort(");
      // The peers of the children come with it, so that the exit of a child is seen (T86).
      expect(project.generated["main.ts"]).toContain("export function attachUtility(");
      expect(project.generated["main.ts"]).toContain("export function forkUtility(");
      expect(project.generated["main.ts"]).not.toContain("ipcMain");
      expect(project.generated["main.ts"]).not.toContain("import type { Row");
   });

   it("exposes the calls to the page, and the connect to the main process only", async () => {
      const project = await fixtures.run("utility-ports");
      const preload = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: preload.electron });
      const paths = [
         "asForm.invoke",
         "countRows.invoke",
         "counter.stream",
         "getUser.invoke",
         "ping.invoke",
         "pulledRows.stream",
         "queryRows.invoke",
         "scanRows.stream",
         "streamForm.stream",
         "tagged.invoke",
         "unboundedRows.stream",
         "windowedRows.stream",
      ];
      expect(callablePaths(preload.exposed.ipc)).toStrictEqual(paths);
      expect(windowIpcPaths(project.generated["types.ts"])).toStrictEqual(paths);
      expect(project.generated["preload.ts"]).not.toContain("indexFile");
      expect(project.generated["types.ts"]).not.toContain("indexFile");

      const main = await loadMain();
      expect(callablePaths(main)).toContain("queryRows.connect");
      expect(callablePaths(main)).not.toContain("queryRows.invoke");
   });

   it("declares IpcUtilityError for the page only when a channel to a utility process exists", async () => {
      const withUtility = await fixtures.run("utility-ports");
      expect(withUtility.generated["types.ts"]).toContain("type IpcUtilityError = Error & {");

      const project = await fixtures.run("utility-channels");
      expect(project.generated["types.ts"]).not.toContain("IpcUtilityError");
   });
});
