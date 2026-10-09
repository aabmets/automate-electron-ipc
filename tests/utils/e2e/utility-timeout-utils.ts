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

import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { vi } from "vitest";
import { FakePagePort } from "./fake-ports.js";
import { resetUtilityProcessFakes } from "./fake-utility.js";
import { wire } from "./wire-utils.js";

/** Starts a call and watches how it settles, so that no rejection is left unhandled. */
export function track(promise: Promise<unknown>) {
   const state: { status: "pending" | "resolved" | "rejected"; value?: any } = {
      status: "pending",
   };
   promise.then(
      (value) => {
         state.status = "resolved";
         state.value = value;
      },
      (error) => {
         state.status = "rejected";
         state.value = error;
      },
   );
   return state;
}

/** Undoes what the helpers and the tests set up. Call it from `afterEach`. */
export function resetTimeoutFakes() {
   resetUtilityProcessFakes();
   vi.useRealTimers();
   vi.restoreAllMocks();
}

/** Loads the generated `preload.ts` with a fake Electron, and gives the page side of the ports. */
export function loadPageBindings(preloadSource: string) {
   const fake = createFakePreloadElectron();
   loadGenerated(preloadSource, { electron: fake.electron });
   const listener = (channel: string) => {
      const found = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      return found?.[1] as (event: unknown, key: unknown) => void;
   };
   const arrive = (name: string, key = "1:utility") => {
      const port = new FakePagePort();
      listener(wire(name))({ ports: [port] }, key);
      return port;
   };
   const closeFromMain = (name: string, key: string) => listener(`${wire(name)}:close`)({}, key);
   return { api: fake.exposed.ipc, arrive, closeFromMain };
}
