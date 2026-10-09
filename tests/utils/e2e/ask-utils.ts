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

import { createFakeElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { vi } from "vitest";
import { fixtures } from "../fixture-tracker.js";

/** The project that the last helper generated, for a test which reads its files. */
export const currentProject = fixtures.current;

/** Restores the real timers. */
export function cleanupAsks() {
   vi.useRealTimers();
}

export const request = (name: string) => `autoipc:${name}`;
export const replyOf = (name: string) => `autoipc:${name}:reply`;

/** A WebFrameMain stand-in, which has no `getURL` and is not an emitter of `destroyed`. */
export function createFrame(
   ids: { processId: number; routingId: number },
   state: { destroyed?: boolean; detached?: boolean } = {},
) {
   const frame = {
      ...ids,
      destroyed: state.destroyed ?? false,
      detached: state.detached ?? false,
      send: vi.fn(),
      isDestroyed: () => frame.destroyed,
   };
   return frame;
}

/** The IDs and arguments of the questions that were sent to a target. */
export function questions(send: ReturnType<typeof vi.fn>, name: string): [number, ...unknown[]][] {
   return send.mock.calls
      .filter(([channel]) => channel === request(name))
      .map(([, id, ...args]) => [id, ...args]);
}

export async function loadMain(fixture = "ask-channels", fromFrame?: (frame: unknown) => unknown) {
   const project = await fixtures.run(fixture);
   const electron = createFakeElectron();
   Object.assign(electron, {
      webContents: { getAllWebContents: vi.fn(() => []), fromFrame: fromFrame ?? vi.fn() },
   });
   const generated = loadGenerated(project.generated["main.ts"], { electron });
   const { ipc, IpcAskError } = generated;

   /** The listener that the generated code registered for the replies of the channel. */
   const replyListener = (name: string) => {
      const call = electron.ipcMain.on.mock.calls.find(([channel]) => channel === replyOf(name));
      return (call?.[1] as (...args: unknown[]) => void) ?? null;
   };
   /** Delivers a reply to the main process as `sender` (and `senderFrame`) sent it. */
   const reply = (
      name: string,
      sender: unknown,
      id: unknown,
      envelope: unknown,
      senderFrame: unknown = null,
   ) => {
      const listener = replyListener(name);
      if (!listener) {
         throw new Error(`No reply listener for '${name}'`);
      }
      listener({ sender, senderFrame }, id, envelope);
   };
   return { ipc, IpcAskError, electron, replyListener, reply };
}
