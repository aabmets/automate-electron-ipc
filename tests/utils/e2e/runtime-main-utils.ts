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

import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { WIRE_PREFIX } from "./wire-utils.js";

let project: E2EProject | undefined;

/** The project that the last helper generated. */
export const currentProject = () => project;

/** Generates a fixture, and keeps it so that `cleanupRuntime` removes it. */
export async function generateFixture(name: string) {
   project = await runFixture(name);
   return project;
}

/** Removes the generated project of the test. */
export async function cleanupRuntime() {
   await project?.cleanup();
   project = undefined;
}

/** Runs the generated preload script against a fake contextBridge and ipcRenderer. */
export async function loadPreload(fixture: string) {
   const project = await generateFixture(fixture);
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   return { ...fake, project };
}

/**
 * Turns the reply of a generated invoke handler into what the renderer sees: the value of an
 * ok envelope, or a rejection carrying `name`, `message`, `code` and `data` of the error.
 */
function unwrapEnvelope(handler: (...args: unknown[]) => unknown) {
   return async (...args: unknown[]) => {
      const reply = (await handler(...args)) as {
         ok: boolean;
         value?: unknown;
         error?: { name: string; message: string };
      };
      if (reply.ok) {
         return reply.value;
      }
      throw Object.assign(new Error(reply.error?.message), reply.error);
   };
}

/** Backs the fake ipcMain with a real emitter, so that registrations are observable. */
export async function loadMainWithEmitter(
   fixture = "all-kinds",
   modules: Record<string, unknown> = {},
) {
   const { EventEmitter } = await import("node:events");
   const emitter = new EventEmitter();
   // What the renderer gets: the value of an ok envelope, or a rejection which carries the
   // fields of the error object. `envelopes` holds the replies as the main process sends them.
   const handlers = new Map<string, (...args: unknown[]) => unknown>();
   const envelopes = new Map<string, (...args: unknown[]) => unknown>();
   const electron = createFakeElectron();
   // The tests name channels as the schema does, so the prefix is removed from what Electron gets.
   const bare = (channel: string) => channel.replace(WIRE_PREFIX, "");
   Object.assign(electron.ipcMain, {
      on: (channel: string, listener: (...args: unknown[]) => void) =>
         emitter.on(bare(channel), listener),
      once: (channel: string, listener: (...args: unknown[]) => void) =>
         emitter.once(bare(channel), listener),
      off: (channel: string, listener: (...args: unknown[]) => void) =>
         emitter.off(bare(channel), listener),
      handle: (rawChannel: string, handler: (...args: unknown[]) => unknown) => {
         const channel = bare(rawChannel);
         if (envelopes.has(channel)) {
            throw new Error(`Attempted to register a second handler for '${channel}'`);
         }
         envelopes.set(channel, handler);
         handlers.set(channel, unwrapEnvelope(handler));
      },
      handleOnce: (channel: string, handler: (...args: unknown[]) => unknown) => {
         electron.ipcMain.handle(channel, (...args: unknown[]) => {
            handlers.delete(bare(channel));
            envelopes.delete(bare(channel));
            return handler(...args);
         });
      },
      removeHandler: (rawChannel: string) => {
         handlers.delete(bare(rawChannel));
         envelopes.delete(bare(rawChannel));
      },
   });
   const project = await generateFixture(fixture);
   const generated = loadGenerated(project.generated["main.ts"], { electron, ...modules });
   return { emitter, handlers, envelopes, ipc: generated.ipc, generated };
}
