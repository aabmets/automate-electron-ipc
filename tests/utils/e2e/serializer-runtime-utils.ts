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
import fsp from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";
import { type E2EProject, runFixture } from "../e2e-utils.js";
import { createFakeElectron, createFakePreloadElectron, loadGenerated } from "./runtime-utils.js";

/** The `Appointment` of the fixture, with the types that structured clone cannot tell apart. */
export const appointment = () => ({
   at: new Date("2026-10-09T10:00:00.000Z"),
   tags: new Set(["a", "b"]),
   attendees: new Map([["ada", 2]]),
   budget: 10n,
});

type Listener = (...args: any[]) => unknown;

/** The listeners of a fake `ipcMain` or `ipcRenderer`, by channel, which `off` removes from. */
function createRegistry() {
   const listeners = new Map<string, Set<Listener>>();
   return {
      add: (wire: string, listener: Listener) => {
         listeners.set(wire, (listeners.get(wire) ?? new Set()).add(listener));
      },
      remove: (wire: string, listener: Listener) => listeners.get(wire)?.delete(listener),
      of: (wire: string) => [...(listeners.get(wire) ?? [])],
   };
}

/**
 * Makes the `connect` function of one test file. `track` gets the project of each run, so that the
 * file can delete it in its own `afterEach`.
 *
 * `connect` loads the generated main bindings and preload script of a fixture next to each other,
 * with the serializer of the fixture, and connects them the way Electron does: whatever crosses is
 * cloned.
 */
export function serializerConnector(track: (project: E2EProject) => void) {
   return async function connect(
      fixture = "serializer",
      options: { validateSender?: boolean } = {},
   ) {
      const project = await runFixture(fixture);
      track(project);
      const read = (name: string) => fsp.readFile(path.join(project.dir, "ipc", name), "utf8");
      const serializer = loadGenerated(await read("serializer.ts"), {});
      const spied = {
         serialize: vi.fn(serializer.serialize),
         deserialize: vi.fn(serializer.deserialize),
      };

      // Both sides keep their listeners, so that `off` and `once` work as they do in Electron.
      const mainOn = createRegistry();
      const handlers = new Map<string, Listener>();
      const main = createFakeElectron();
      main.ipcMain.on.mockImplementation(mainOn.add);
      main.ipcMain.off.mockImplementation(mainOn.remove);
      main.ipcMain.handle.mockImplementation((wire: string, handler: Listener) => {
         handlers.set(wire, handler);
      });
      main.ipcMain.removeHandler.mockImplementation((wire: string) => handlers.delete(wire));

      const page = createFakePreloadElectron();
      const pageOn = createRegistry();
      page.electron.ipcRenderer.on.mockImplementation(pageOn.add);
      page.electron.ipcRenderer.removeListener.mockImplementation(pageOn.remove);
      const toPage = (wire: string, ...args: unknown[]) => {
         for (const listener of pageOn.of(wire)) {
            listener({}, ...structuredClone(args));
         }
      };
      const contents = Object.assign(new EventEmitter(), {
         id: 1,
         getURL: () => "app://.",
         isDestroyed: () => false,
         isCrashed: () => false,
         send: vi.fn(toPage),
      });
      Object.assign(main, {
         webContents: { getAllWebContents: vi.fn(() => [contents]), fromFrame: vi.fn() },
      });

      const validators =
         fixture === "serializer" ? loadGenerated(await read("validators.ts"), {}) : {};
      const mainModules = loadGenerated(project.generated["main.ts"], {
         electron: main,
         "./serializer": spied,
         "./validators": validators,
      });
      loadGenerated(project.generated["preload.ts"], {
         electron: page.electron,
         "./serializer": spied,
      });

      const frame = {
         origin: "app://.",
         detached: false,
         isDestroyed: () => false,
         isCrashed: () => false,
         send: vi.fn(toPage),
         postMessage: vi.fn(),
      };
      const event = { sender: contents, senderFrame: frame };
      page.electron.ipcRenderer.invoke.mockImplementation(
         async (wire: string, ...args: unknown[]) =>
            handlers.get(wire)?.(event, ...structuredClone(args)),
      );
      page.electron.ipcRenderer.send.mockImplementation((wire: string, ...args: unknown[]) => {
         for (const listener of mainOn.of(wire)) {
            listener(event, ...structuredClone(args));
         }
      });
      if (options.validateSender) {
         mainModules.configureIpc({ validateSender: () => false });
      }
      return {
         ipc: mainModules.ipc as any,
         main: mainModules,
         page: page.exposed.ipc as any,
         pageElectron: page.electron,
         mainElectron: main,
         contents,
         spied,
         event,
         /** The function that the generated main process registered with `ipcMain.handle`. */
         handler: (wire: string) => handlers.get(wire) as Listener,
         /** The listener that the generated main process registered with `ipcMain.on`. */
         mainListener: (wire: string) => mainOn.of(wire)[0],
         /** The listener that the preload script registered with `ipcRenderer.on`. */
         pageListener: (wire: string) => pageOn.of(wire)[0],
      };
   };
}

export type Connection = Awaited<ReturnType<ReturnType<typeof serializerConnector>>>;
