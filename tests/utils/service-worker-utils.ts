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

/** The wire name of a channel, with the channel prefix that the fixtures use. */
export const wire = (name: string) => `autoipc:${name}`;

/** A `ServiceWorkerMain` stand-in with the `ipc` of a worker, which records what is registered. */
export function createWorker(versionId = 1, scope = "app://main/") {
   const handlers = new Map<string, (...args: any[]) => unknown>();
   const listeners = new Map<string, ((...args: any[]) => unknown)[]>();
   const end = vi.fn();
   const worker = {
      versionId,
      scope,
      scriptURL: `${scope}sw.js`,
      destroyed: false,
      isDestroyed: () => worker.destroyed,
      send: vi.fn(),
      startTask: vi.fn(() => ({ end })),
      ipc: {
         handle: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
            if (handlers.has(channel)) {
               throw new Error(`Attempted to register a second handler for '${channel}'`);
            }
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
      end,
      handlers,
      listeners,
      /**
       * The worker calls a channel of the main process like `ipcRenderer.invoke` does: Electron
       * rejects a call without a handler, and wraps what a handler throws in an Error of its own.
       */
      invoke: async (channel: string, ...args: unknown[]) => {
         const name = wire(channel);
         const handler = handlers.get(name);
         try {
            if (!handler) {
               throw new Error(`No handler registered for '${name}'`);
            }
            return await handler(event(), ...args);
         } catch (error) {
            throw new Error(`Error invoking remote method '${name}': ${String(error)}`);
         }
      },
      /** The worker sends to a channel of the main process like `ipcRenderer.send` does. */
      sendFrom: (channel: string, ...args: unknown[]) => {
         for (const listener of listeners.get(wire(channel)) ?? []) {
            listener(event(), ...args);
         }
      },
      /** The worker answers a question of the main process. */
      reply: (channel: string, id: unknown, envelope: unknown) => {
         for (const listener of listeners.get(wire(`${channel}:reply`)) ?? []) {
            listener(event(), id, envelope);
         }
      },
      /** The id of the last question that the main process sent to the worker. */
      lastId: () => worker.send.mock.calls.at(-1)?.[1] as number,
   };
}

/** A `Session` stand-in, whose workers start and stop on the command of the test. */
export function createSession() {
   const known = new Map<number, ReturnType<typeof createWorker>>();
   const serviceWorkers = Object.assign(new EventEmitter(), {
      getAllRunning: vi.fn(() => Object.fromEntries([...known.keys()].map((id) => [id, {}]))),
      getWorkerFromVersionID: vi.fn((id: number) => known.get(id)?.worker),
   });
   const session = { serviceWorkers };
   return {
      session,
      serviceWorkers,
      /** Adds a worker that runs already, without an event. */
      add: (fake: ReturnType<typeof createWorker>) => known.set(fake.worker.versionId, fake),
      /** Starts a worker and tells the session about it. */
      start: (fake: ReturnType<typeof createWorker>, status = "starting") => {
         known.set(fake.worker.versionId, fake);
         serviceWorkers.emit("running-status-changed", {
            versionId: fake.worker.versionId,
            runningStatus: status,
         });
      },
      status: (versionId: number, runningStatus: string) =>
         serviceWorkers.emit("running-status-changed", { versionId, runningStatus }),
      stop: (fake: ReturnType<typeof createWorker>, status = "stopped") => {
         known.delete(fake.worker.versionId);
         serviceWorkers.emit("running-status-changed", {
            versionId: fake.worker.versionId,
            runningStatus: status,
         });
      },
   };
}
