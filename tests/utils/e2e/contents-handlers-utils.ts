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

// T34: `ipc.<name>.on` / `handle` (and `once` and `handleOnce`) take `{ webContents }` and register
// on `webContents.ipc` instead of the global `ipcMain`. The fake contents here follow the dispatch
// of Electron: a message goes to `webContents.ipc` first and then to `ipcMain`. An `invoke` goes
// to the first of the two that has a handler, and a `send` goes to the listeners of both.

/** The fixture project that `loadMain` made, which `disposeContentsFixture` cleans up. */
let project: E2EProject | undefined;

/** An `IpcMain` stand-in: real listeners, and handlers which refuse a second one like Electron's. */
export function createFakeIpc() {
   const emitter = new EventEmitter().setMaxListeners(0);
   const handlers = new Map<string, (...args: any[]) => any>();
   return {
      emitter,
      handlers,
      on: vi.fn((channel: string, listener: (...args: any[]) => void) =>
         emitter.on(channel, listener),
      ),
      off: vi.fn((channel: string, listener: (...args: any[]) => void) =>
         emitter.off(channel, listener),
      ),
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
         if (handlers.has(channel)) {
            throw new Error(`Attempted to register a second handler for '${channel}'`);
         }
         handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
   };
}

export type FakeIpc = ReturnType<typeof createFakeIpc>;

let lastContentsId = 0;

export function createContents() {
   const contents = Object.assign(new EventEmitter(), {
      id: ++lastContentsId,
      ipc: createFakeIpc(),
      destroyed: false,
      isDestroyed: () => contents.destroyed,
      destroy() {
         contents.destroyed = true;
         contents.emit("destroyed");
      },
   });
   return contents;
}

export type Contents = ReturnType<typeof createContents>;

/** The event of a call from the main frame of the contents. */
export const eventFrom = (sender: Contents, origin = "app://.") => ({
   sender,
   senderFrame: { origin },
});

export async function loadMain(fixture = "all-kinds") {
   project = await runFixture(fixture);
   const globalIpc = createFakeIpc();
   const electron = { ...createFakeElectron(), ipcMain: globalIpc };
   // The fixture of the streams imports a validator, which the stream never calls here.
   const generated = loadGenerated(project.generated["main.ts"], {
      electron,
      "./validators": { __esModule: true, countArgs: {} },
   });
   /** Delivers an `invoke` of the page the way Electron does: the first target with a handler answers. */
   const invoke = async (contents: Contents, channel: string, ...args: unknown[]) => {
      const target: FakeIpc | undefined = [contents.ipc, globalIpc].find((ipc) =>
         ipc.handlers.has(`autoipc:${channel}`),
      );
      if (!target) {
         throw new Error(`No handler registered for '${channel}'`);
      }
      return await target.handlers.get(`autoipc:${channel}`)?.(eventFrom(contents), ...args);
   };
   /** Delivers a `send` of the page: the listeners of the contents, then the global ones. */
   const send = (contents: Contents, channel: string, ...args: unknown[]) => {
      const event = eventFrom(contents);
      contents.ipc.emitter.emit(`autoipc:${channel}`, event, ...args);
      globalIpc.emitter.emit(`autoipc:${channel}`, event, ...args);
   };
   return { generated, ipc: generated.ipc, globalIpc, invoke, send };
}

export const ok = (value: unknown) => ({ ok: true, value });

/** Cleans up the project of `loadMain`. Call it from `afterEach`. */
export async function disposeContentsFixture() {
   await project?.cleanup();
   project = undefined;
}
