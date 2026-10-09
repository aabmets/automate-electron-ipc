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
import { tmpdir } from "node:os";
import path from "node:path";
import cfg from "@src/config.js";
import type * as t from "@types";
import { afterEach, beforeEach, vi } from "vitest";

/** Makes `getResolvedConfig` resolve a config whose generated files are written under `dir/out`. */
function mockAutomationConfig(dir: string, overrides: Partial<t.IPCResolvedConfig>): void {
   vi.spyOn(cfg, "getResolvedConfig").mockResolvedValue({
      codeIndent: 3,
      projectUsesNodeNext: false,
      ipcDataDir: "ipc",
      projectRoot: dir,
      mainBindingsFilePath: path.join(dir, "out/main.ts"),
      preloadBindingsFilePath: path.join(dir, "out/preload.ts"),
      rendererTypesFilePath: path.join(dir, "out/window.d.ts"),
      typesFilePath: path.join(dir, "out/types.ts"),
      utilityBindingsFilePath: path.join(dir, "out/utility.ts"),
      serviceWorkerPreloadFilePath: path.join(dir, "out/service-worker-preload.ts"),
      serviceWorkerTypesFilePath: path.join(dir, "out/service-worker.d.ts"),
      ...overrides,
   } as t.IPCResolvedConfig);
}

/**
 * A temp directory for each test of the file or the `describe` block that calls it. It registers its
 * own hooks: the directory is made before each test, and removed after it, with the mocks restored.
 * `dir` is the directory of the running test, and `mockConfig` resolves a config whose generated
 * files go to `dir/out` (see `mockAutomationConfig`).
 */
export function withAutomationDir(prefix = "vitest-automation-") {
   let dir = "";
   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), prefix));
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });
   return {
      get dir() {
         return dir;
      },
      mockConfig: (overrides: Partial<t.IPCResolvedConfig>) => mockAutomationConfig(dir, overrides),
   };
}
