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

import type { E2EProject } from "../e2e-utils.js";
import { createFakeElectron, loadGenerated } from "./runtime-utils.js";
import { wire } from "./wire-utils.js";

type Handler = (...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: any }>;

/**
 * Makes the `loadMain` function of one test file. `run` is the `run` of the tracker of the file,
 * which deletes the project of each run after the test.
 *
 * `loadMain` loads the generated main bindings and returns the handler that they register for a
 * channel.
 */
export function errorsMainLoader(run: (fixture: string) => Promise<E2EProject>) {
   return async function loadMain(fixture: string) {
      const project = await run(fixture);
      const electron = createFakeElectron();
      const generated = loadGenerated(project.generated["main.ts"], { electron });
      const handlerOf = (channel: string): Handler => {
         const call = electron.ipcMain.handle.mock.calls.find(([name]) => name === wire(channel));
         return call?.[1] as Handler;
      };
      return { electron, generated, handlerOf, ipc: generated.ipc };
   };
}
