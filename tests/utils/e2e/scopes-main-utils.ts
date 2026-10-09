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
import { expect } from "vitest";

/** The fixture project that `loadMain` made, which `disposeScopesFixture` cleans up. */
let project: E2EProject | undefined;

/** A WebContents stand-in: an emitter with an ID, which can be destroyed. */
export function createContents(id: number) {
   const contents = Object.assign(new EventEmitter(), {
      id,
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

/** The event of a call from a frame of the contents. */
export const callFrom = (sender: Contents | null, origin: string | null = "app://.") => ({
   sender,
   senderFrame: origin === null ? null : { origin },
});

/** Loads the main bindings with an `ipcMain` which keeps the listeners and the handlers. */
export async function loadMain(fixture = "scoped-windows") {
   project = await runFixture(fixture);
   const handlers = new Map<string, (...args: any[]) => any>();
   const emitter = new EventEmitter();
   const electron = createFakeElectron();
   Object.assign(electron.ipcMain, {
      on: (channel: string, listener: (...args: any[]) => void) => emitter.on(channel, listener),
      off: (channel: string, listener: (...args: any[]) => void) => emitter.off(channel, listener),
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
   });
   const generated = loadGenerated(project.generated["main.ts"], { electron });
   /** Calls the handler of an invoke channel, and returns its envelope. */
   const call = (channel: string, event: unknown, ...args: unknown[]) =>
      handlers.get(`autoipc:${channel}`)?.(event, ...args);
   return { generated, ipc: generated.ipc, emitter, call, project };
}

/** Cleans up the project of `loadMain`. Call it from `afterEach`. */
export async function disposeScopesFixture() {
   await project?.cleanup();
   project = undefined;
}

export const forbidden = (channel: string) => ({
   ok: false,
   error: {
      name: "IpcForbiddenError",
      message: expect.stringContaining(`'${channel}'`),
      code: "IPC_FORBIDDEN",
   },
});
