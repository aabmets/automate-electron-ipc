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
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { createFakePreloadElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

describe("fixture expose-as, with the key 'bridge' in the main world", () => {
   it("declares the variable of window.d.ts under the key", async () => {
      project = await runFixture("expose-as");
      const types = project.generated["window.d.ts"];

      expect(types).toContain("var bridge: IpcApi;");
      expect(types).not.toContain("var ipc");
      expect(types).not.toContain("isolated world");
   });

   it("exposes the API in the main world under the key", async () => {
      project = await runFixture("expose-as");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      expect(fake.electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
      expect(Object.keys(fake.exposed)).toStrictEqual(["bridge"]);
      expect(Object.keys(fake.exposed.bridge).sort()).toStrictEqual([
         "chat",
         "getUser",
         "logLine",
         "progress",
      ]);
      expect(fake.electron.contextBridge.exposeInIsolatedWorld).not.toHaveBeenCalled();
   });

   it("generates files that type-check, with the API used as window.bridge and globalThis.bridge", async () => {
      project = await runFixture("expose-as");

      expect(await project.typecheck()).toBe("");
   });

   it("fails the type-check when the API is used under the default name", async () => {
      project = await runFixture("expose-as");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace("window.bridge.logLine", "window.ipc.logLine"));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });
});

describe("fixture isolated-world, with the key 'api' in the world 1004", () => {
   it("declares the variable under the key, and notes the world", async () => {
      project = await runFixture("isolated-world");

      expect(project.generated["window.d.ts"]).toContain(
         "/** Exposed in the isolated world 1004, so only scripts of that world can use it. */\n   var api: IpcApi;",
      );
   });

   it("exposes the API in the isolated world, and not in the main world", async () => {
      project = await runFixture("isolated-world");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      expect(fake.electron.contextBridge.exposeInIsolatedWorld).toHaveBeenCalledTimes(1);
      expect(
         fake.electron.contextBridge.exposeInIsolatedWorld.mock.calls[0].slice(0, 2),
      ).toStrictEqual([1004, "api"]);
      expect(Object.keys(fake.exposedInWorld[1004].api).sort()).toStrictEqual([
         "chat",
         "getUser",
         "logLine",
         "progress",
      ]);
      expect(fake.electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
      expect(fake.exposed).toStrictEqual({});
   });

   it("generates files that type-check", async () => {
      project = await runFixture("isolated-world");

      expect(await project.typecheck()).toBe("");
   });
});
