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

import path from "node:path";
import cfg from "@src/config.js";
import type * as t from "@types";
import { vi } from "vitest";

/** Makes `getResolvedConfig` resolve a config whose generated files are written under `dir/out`. */
export function mockAutomationConfig(dir: string, overrides: Partial<t.IPCResolvedConfig>): void {
   vi.spyOn(cfg, "getResolvedConfig").mockResolvedValue({
      codeIndent: 3,
      projectUsesNodeNext: false,
      ipcDataDir: "ipc",
      mainBindingsFilePath: path.join(dir, "out/main.ts"),
      preloadBindingsFilePath: path.join(dir, "out/preload.ts"),
      rendererTypesFilePath: path.join(dir, "out/window.d.ts"),
      utilityBindingsFilePath: path.join(dir, "out/utility.ts"),
      serviceWorkerPreloadFilePath: path.join(dir, "out/service-worker-preload.ts"),
      serviceWorkerTypesFilePath: path.join(dir, "out/service-worker.d.ts"),
      ...overrides,
   } as t.IPCResolvedConfig);
}
