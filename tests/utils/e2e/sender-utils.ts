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

import { vi } from "vitest";
import type { E2EProject } from "../e2e-utils.js";
import { createFakeElectron, loadGenerated } from "./runtime-utils.js";

/** A WebContents stand-in: it is destroyed when `destroyed` is set, and sending then throws. */
export function createContents(id: number, destroyed = false) {
   const contents = {
      id,
      destroyed,
      send: vi.fn(() => {
         if (contents.destroyed) {
            throw new Error("Object has been destroyed");
         }
      }),
      isDestroyed: () => contents.destroyed,
   };
   return contents;
}

/**
 * Makes the `loadMain` function of one test file. `run` is the `run` of the tracker of the file,
 * which deletes the project of each run after the test.
 */
export function mainLoader(run: (fixture: string) => Promise<E2EProject>) {
   return async function loadMain(open: ReturnType<typeof createContents>[] = []) {
      const project = await run("all-kinds");
      const electron = createFakeElectron();
      const getAllWebContents = vi.fn(() => open);
      Object.assign(electron, { webContents: { getAllWebContents } });
      const { ipc } = loadGenerated(project.generated["main.ts"], { electron });
      return { ipc, getAllWebContents };
   };
}
