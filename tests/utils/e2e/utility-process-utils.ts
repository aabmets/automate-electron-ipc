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

import { EventEmitter } from "node:events";
import { createFakeElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { vi } from "vitest";
import { wire } from "./wire-utils.js";

let project: E2EProject | undefined;
/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;

/**
 * A `UtilityProcess` stand-in: an emitter with `postMessage`, which the main process uses. It is
 * attached to the bindings like a child from `forkUtility`, unless `attached` is false.
 */
export function createChild({ attached = true } = {}) {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   if (attached) {
      attachChild?.(child);
   }
   /** The messages that the main process posted to the child, with the given tag. */
   const posted = (tag: string, channel?: string) =>
      child.postMessage.mock.calls
         .map(([message]) => message as Record<string, unknown>)
         .filter((m) => m.__ipc === tag && (channel === undefined || m.channel === wire(channel)));
   /** The child posts a message to the main process. */
   const emitFromChild = (message: unknown) => child.emit("message", message);
   return { child, posted, emitFromChild };
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
export function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   const posted = (tag: string, channel?: string) =>
      port.postMessage.mock.calls
         .map(([message]) => message as Record<string, unknown>)
         .filter((m) => m.__ipc === tag && (channel === undefined || m.channel === wire(channel)));
   /** The main process posts a message to the child, which arrives as `{ data }`. */
   const emitFromMain = (data: unknown) => port.emit("message", { data });
   return { port, posted, emitFromMain };
}

export async function load(fixture = "utility-channels") {
   project = await runFixture(fixture);
   const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
   attachChild = main.attachUtility;
   const utilitySource = project.generated["utility.ts"];
   const utility = utilitySource ? loadGenerated(utilitySource, {}) : undefined;
   return { main, utility };
}

/** Undoes what `load`, `createChild` and `createParentPort` set up. Call it from `afterEach`. */
export async function resetUtilityFakes() {
   attachChild = undefined;
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
}
