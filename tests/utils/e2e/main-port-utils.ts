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
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { vi } from "vitest";

const rawPorts: MessagePort[] = [];
let project: E2EProject | undefined;

export const wire = (name: string) => `autoipc:${name}`;
export const closeWire = (name: string) => `autoipc:${name}:close`;
export const disconnectWire = (name: string) => `autoipc:${name}:disconnect`;

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent to it. */
export function createContents(state: { loading?: boolean; url?: string } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      loading: state.loading ?? false,
      url: state.url ?? "app://.",
      destroyed: false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}
export type FakeContents = ReturnType<typeof createContents>;

/** Destroys contents the way Electron does: they emit `destroyed` once they cannot be used. */
export function destroy(contents: FakeContents) {
   contents.destroyed = true;
   contents.emit("destroyed");
}

/** A `MessagePortMain`: an emitter with the methods of the generated code, and records of them. */
export class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

/** The ports a `MessageChannelMain` made, in order. */
export const channelsMade: { port1: FakePortMain; port2: object }[] = [];

export class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = { name: `port2 of ${channelsMade.length + 1}` };
   constructor() {
      channelsMade.push(this);
   }
}

export async function loadMainWithElectron(channelClass: unknown = FakeChannelMain) {
   project = await runFixture("main-port");
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass };
   return { electron, ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc };
}

export async function loadMain() {
   return (await loadMainWithElectron()).ipc;
}

/** The listener that the main process registered for the page which ends a connection. */
export function disconnectListener(electron: ReturnType<typeof createFakeElectron>) {
   const call = electron.ipcMain.on.mock.calls.find(
      ([channel]: [string]) => channel === disconnectWire("logTail"),
   );
   return call?.[1] as (event: { sender: unknown }, key: unknown) => void;
}

/** The main port of the last pair that was made. */
export const lastPort = () => channelsMade[channelsMade.length - 1].port1;

/** Delivers a message from the page to the main port, the way Electron does. */
export const fromPage = (port: FakePortMain, data: unknown) => port.emit("message", { data });

/**
 * A `MessagePortMain` over a real `MessagePort`: Electron's port reports `{ data }` to `message`
 * listeners and has `start()`, which this one maps to the web API.
 */
export class RealPortMain extends EventEmitter {
   private readonly raw: MessagePort;
   constructor(raw: MessagePort) {
      super();
      this.raw = raw;
      raw.addEventListener("message", (event) => this.emit("message", { data: event.data }));
      raw.addEventListener("close", () => this.emit("close"));
      rawPorts.push(raw);
   }
   start() {
      this.raw.start();
   }
   postMessage(message: unknown) {
      this.raw.postMessage(message);
   }
   close() {
      this.raw.close();
   }
}

export class RealChannelMain {
   port1: RealPortMain;
   port2: MessagePort;
   constructor() {
      const channel = new MessageChannel();
      this.port1 = new RealPortMain(channel.port1);
      this.port2 = channel.port2;
      rawPorts.push(channel.port2);
   }
}

/** Both generated scripts, wired to each other the way Electron does for one page. */
export async function loadBoth() {
   const { electron, ipc: mainIpc } = await loadMainWithElectron(RealChannelMain);
   const fake = createFakePreloadElectron();
   if (!project) {
      throw new Error("The fixture was not generated");
   }
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const pageListener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   const contents = createContents();
   contents.postMessage.mockImplementation((channel: string, key: string, ports: unknown[]) =>
      pageListener(channel)({ ports }, key),
   );
   contents.send.mockImplementation((channel: string, key: string) =>
      pageListener(channel)({}, key),
   );
   fake.electron.ipcRenderer.send.mockImplementation((channel: string, key: string) => {
      if (channel === disconnectWire("logTail")) {
         disconnectListener(electron)({ sender: contents }, key);
      }
   });
   return { mainIpc, contents, page: fake.exposed.ipc.logTail };
}

/** Closes what the helpers of this module opened, and removes their project. */
export async function cleanupMainPorts() {
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
}
