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
import { createFakeElectron, createSource, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { vi } from "vitest";
import { wire } from "./wire-utils.js";

export const portWire = (name: string) => `autoipc:${name}:port`;

let project: E2EProject | undefined;
/** The raw ports that a test made, which the cleanup closes. */
export const rawPorts: MessagePort[] = [];

/** The project that the last helper generated, for a test which reads its files. */
export const currentProject = () => project;

/** Generates a fixture, and keeps it so that `cleanupStreams` removes it. */
export async function generateFixture(name: string) {
   project = await runFixture(name);
   return project;
}

/** Restores the mocks, closes the raw ports and removes the generated project. */
export async function cleanupStreams() {
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
}

/** A WebContents stand-in: an emitter that announces its end, as the real one does. */
export function createContents(id = 1) {
   const contents = Object.assign(new EventEmitter(), {
      id,
      postMessage: vi.fn(),
      isDestroyed: () => false,
   });
   return contents;
}
export type FakeContents = ReturnType<typeof createContents>;

/** A WebFrameMain stand-in, which can be told to be destroyed or detached. */
export function createFrame(
   state: { origin?: string; destroyed?: boolean; detached?: boolean } = {},
) {
   return {
      origin: state.origin ?? "app://.",
      detached: state.detached ?? false,
      postMessage: vi.fn(),
      isDestroyed: () => state.destroyed ?? false,
   };
}

/** The event of a call, as `ipcMain.handle` gives it to the handler. */
export function createEvent(sender: FakeContents, frame: object | null = createFrame()) {
   return { sender, senderFrame: frame };
}

/** A `MessagePortMain`: an emitter with the methods of the generated code, and records of them. */
export class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

/** The channels the generated main process made, in order. */
export const channelsMade: { port1: FakePortMain; port2: object }[] = [];

export class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = { name: `port2 of ${channelsMade.length + 1}` };
   constructor() {
      channelsMade.push(this);
   }
}

export async function loadMainWith(channelClass: unknown, fixture = "stream-channels") {
   const project = await generateFixture(fixture);
   channelsMade.length = 0;
   const electron = {
      ...createFakeElectron(),
      MessageChannelMain: channelClass,
      webContents: { getAllWebContents: vi.fn(() => []), fromFrame: vi.fn() },
   };
   // The hand-written schema of the fixture, which the generated code imports.
   const countArgs = {
      "~standard": {
         version: 1,
         vendor: "test",
         validate: (value: unknown) =>
            Array.isArray(value) && value.length === 1 && typeof value[0] === "number"
               ? { value: [value[0]] }
               : { issues: [{ message: "expected one number" }] },
      },
   };
   const generated = loadGenerated(project.generated["main.ts"], {
      electron,
      "./validators": { __esModule: true, countArgs },
   });
   /** The function that `ipcMain.handle` was last given for the channel. */
   const listener = (name: string) => {
      const calls = electron.ipcMain.handle.mock.calls.filter(([w]: [string]) => w === wire(name));
      return calls.at(-1)?.[1] as (event: unknown, ...args: unknown[]) => Promise<any>;
   };
   return { ...generated, electron, listener };
}

export const loadMain = () => loadMainWith(FakeChannelMain);

export const lastChannel = () => channelsMade[channelsMade.length - 1];
/** What the main process posted to the page over the port of the last call. */
export const posted = () => lastChannel().port1.postMessage.mock.calls.map(([message]) => message);
/** Delivers a message from the page to the main port, the way Electron does. */
export const fromPage = (data: unknown) => lastChannel().port1.emit("message", { data });

/** Registers a source as the handler of a channel and starts a call, as the page would. */
export async function start(
   context: Awaited<ReturnType<typeof loadMain>>,
   name: string,
   options: { id?: unknown; args?: unknown[]; contents?: FakeContents; frame?: object | null } = {},
) {
   const source = createSource();
   const handler = vi.fn(() => source.iterable);
   context.ipc[name].handle(handler);
   const contents = options.contents ?? createContents();
   const frame = options.frame === undefined ? createFrame() : options.frame;
   const envelope = await context.listener(name)(
      createEvent(contents, frame),
      options.id ?? 7,
      ...(options.args ?? []),
   );
   return { source, handler, contents, frame: frame as ReturnType<typeof createFrame>, envelope };
}
