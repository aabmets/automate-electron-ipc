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
import { vi } from "vitest";
import type { E2EProject } from "../e2e-utils.js";
import { createFakeElectron, loadGenerated } from "./runtime-utils.js";
import { wire } from "./wire-utils.js";

export type Check = (args: unknown[]) => string | null;

/** A Standard Schema of an argument tuple, whose answer the test can hold back. */
export function schema(check: Check, held = false) {
   const waiting: (() => void)[] = [];
   const validate = vi.fn((value: unknown) => {
      const message = Array.isArray(value) ? check(value) : "not an array";
      const result = message === null ? { value } : { issues: [{ message }] };
      return held ? new Promise((resolve) => waiting.push(() => resolve(result))) : result;
   });
   return {
      "~standard": { version: 1, vendor: "test", validate },
      validate,
      /** Answers the validations that are held back. */
      release: () => {
         for (const answer of waiting.splice(0)) {
            answer();
         }
      },
   };
}

export const oneString: Check = (args) =>
   args.length === 1 && typeof args[0] === "string" ? null : "expected one string";
export const oneNumber: Check = (args) =>
   args.length === 1 && typeof args[0] === "number" ? null : "expected one number";

/** A `ServiceWorkerMain` stand-in with the `ipc` of a worker, which records what is registered. */
export function createWorker(versionId = 1, scope = "app://main/") {
   const handlers = new Map<string, (...args: any[]) => unknown>();
   const listeners = new Map<string, ((...args: any[]) => unknown)[]>();
   const worker = {
      versionId,
      scope,
      scriptURL: `${scope}sw.js`,
      isDestroyed: () => false,
      send: vi.fn(),
      startTask: vi.fn(() => ({ end: vi.fn() })),
      ipc: {
         handle: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
            handlers.set(channel, listener);
         }),
         on: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
            listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
         }),
      },
   };
   const event = () => ({ type: "service-worker", versionId, serviceWorker: worker });
   return {
      worker,
      /** The worker calls a channel of the main process like `ipcRenderer.invoke` does. */
      invoke: (channel: string, ...args: unknown[]) =>
         Promise.resolve(handlers.get(wire(channel))?.(event(), ...args)),
      /** The worker sends to a channel of the main process like `ipcRenderer.send` does. */
      sendFrom: (channel: string, ...args: unknown[]) => {
         for (const listener of listeners.get(wire(channel)) ?? []) {
            listener(event(), ...args);
         }
      },
   };
}

/** A `Session` stand-in with one worker that runs already. */
export function createSession(...workers: ReturnType<typeof createWorker>[]) {
   const known = new Map(workers.map((fake) => [fake.worker.versionId, fake]));
   const serviceWorkers = Object.assign(new EventEmitter(), {
      getAllRunning: vi.fn(() => Object.fromEntries([...known.keys()].map((id) => [id, {}]))),
      getWorkerFromVersionID: vi.fn((id: number) => known.get(id)?.worker),
   });
   return { serviceWorkers };
}

/** Runs the generated `main.ts` of the guards fixture, with the given module for `./validators`. */
export function loadGuardMain(project: E2EProject, validators: Record<string, unknown>): any {
   return loadGenerated(project.generated["main.ts"], {
      electron: createFakeElectron(),
      "./validators": validators,
   });
}
