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
import { vi } from "vitest";
import { type E2EProject, runFixture } from "./e2e-utils.js";
import { createFakeElectron, createFakePreloadElectron, loadGenerated } from "./runtime-utils.js";
import { loadSerializer } from "./serializer-wire-utils.js";
import { createSession, createWorker } from "./service-worker-utils.js";

/**
 * Makes the `connect` function of one test file. `track` gets the project of each run, so that
 * the file can delete it in its own `afterEach`.
 *
 * `connect` loads the main process and the preload script of a service worker, wired to each
 * other the way Electron does it: what crosses is structured cloned, and a message reaches the
 * listeners of the other side. `main.ipc.<name>` is the API of the main process, `api.<name>` the
 * one of the worker.
 */
export function workerConnector(track: (project: E2EProject) => void) {
   return async function connect(fixture = "serializer-worker", wireToWorker = true) {
      const project = await runFixture(fixture);
      track(project);
      const real = await loadSerializer(project);
      // The calls are counted, so that a test sees whether the serializer was used at all.
      const serializer = {
         serialize: vi.fn(real.serialize),
         deserialize: vi.fn(real.deserialize),
      };
      const validators = await fsp
         .readFile(path.join(project.dir, "ipc", "validators.ts"), "utf8")
         .then((source) => loadGenerated(source, {}))
         .catch(() => ({}));
      const main = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
         "./serializer": serializer,
         "./validators": validators,
      });
      const fakePreload = createFakePreloadElectron();
      loadGenerated(project.generated["service-worker-preload.ts"] ?? "", {
         electron: fakePreload.electron,
         "./serializer": serializer,
      });
      const { ipcRenderer } = fakePreload.electron;
      const api = fakePreload.exposed.ipc;

      const fake = createSession();
      const one = createWorker(1);
      main.attachServiceWorkers(fake.session);
      fake.start(one);
      const event = { type: "service-worker", versionId: 1, serviceWorker: one.worker };
      /** What crossed the wire, in each direction. */
      const toMain: unknown[][] = [];
      const toWorker: unknown[][] = [];

      ipcRenderer.invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
         toMain.push([channel, ...args]);
         const handler = one.handlers.get(channel);
         return structuredClone(await handler?.(event, ...structuredClone(args)));
      });
      ipcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
         toMain.push([channel, ...args]);
         for (const listener of one.listeners.get(channel) ?? []) {
            listener(event, ...structuredClone(args));
         }
      });
      one.worker.send.mockImplementation((channel: string, ...args: unknown[]) => {
         toWorker.push([channel, ...args]);
         if (!wireToWorker) {
            return;
         }
         for (const [name, listener] of ipcRenderer.on.mock.calls) {
            if (name === channel) {
               listener({}, ...structuredClone(args));
            }
         }
      });
      return { main, api, fake, one, ipcRenderer, serializer, toMain, toWorker };
   };
}
