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
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   settlePorts,
} from "@testutils/runtime-utils.js";
import { vi } from "vitest";

const channels: MessageChannel[] = [];
let project: E2EProject | undefined;

export const wire = (name: string) => `autoipc:${name}`;
export const closeWire = (name: string) => `autoipc:${name}:close`;
export const disconnectWire = (name: string) => `autoipc:${name}:disconnect`;

/** A window which is loaded unless told otherwise, and whose contents are an emitter. */
export function createWindow(state: { loading?: boolean; url?: string; destroyed?: boolean } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      loading: state.loading ?? false,
      url: state.url ?? "app://.",
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => win.destroyed,
   });
   const win = Object.assign(new EventEmitter(), {
      destroyed: state.destroyed ?? false,
      webContents: contents,
      isDestroyed: () => win.destroyed,
   });
   return win;
}
export type FakeWindow = ReturnType<typeof createWindow>;

/** The events that `connect` listens to on a window and on its contents. */
export const loadEvents = ["did-navigate", "did-fail-load", "did-finish-load", "did-stop-loading"];

/** How many listeners `connect` has left on a window and on its contents. */
export function listenersOn(win: FakeWindow) {
   return {
      closed: win.listenerCount("closed"),
      ...Object.fromEntries(
         loadEvents.map((event) => [event, win.webContents.listenerCount(event)]),
      ),
   };
}
export const noListeners = listenersOn(createWindow());

/** Destroys a window the way Electron does: it emits `closed` once it can no longer be used. */
export function destroy(win: FakeWindow) {
   win.destroyed = true;
   win.emit("closed");
}

/** The wire names and ports of the messages that were posted to a window, in order. */
export const posted = (win: FakeWindow) => win.webContents.postMessage.mock.calls;

export async function loadMain() {
   return (await loadMainWithElectron()).ipc;
}

/** Loads the generated main process, and returns the fake `electron` it was given as well. */
export async function loadMainWithElectron(channelClass?: unknown) {
   project = await runFixture("port-only");
   let created = 0;
   class FakeChannel {
      id = ++created;
      port1 = { name: `port1 of ${this.id}` };
      port2 = { name: `port2 of ${this.id}` };
   }
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass ?? FakeChannel };
   return { electron, ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc };
}

/** Loads the generated preload script, and returns what it exposes and listens to. */
export async function loadPreload() {
   project = await runFixture("port-only");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   const chat = fake.exposed.ipc.chat;

   /**
    * Hands the page one end of a real channel under the key of a connection, and returns the other
    * end for the test. The same key again is a new port for that connection.
    */
   const connect = (key = "1:a") => {
      const channel = new MessageChannel();
      channels.push(channel);
      listener(wire("chat"))({ ports: [channel.port1] }, key);
      const peer = channel.port2;
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);
      return { channel, peer, received };
   };
   /** Tells the page that the main process ended the connection of a key. */
   const end = (key = "1:a") => listener(closeWire("chat"))({}, key);
   return { chat, connect, listener, end, ipcRenderer: fake.electron.ipcRenderer };
}

/** Lets the messages and the events of the real ports arrive. */
export const settle = () => settlePorts(20);

/** A hub page with `count` peers, each with the connection object that `onConnection` gave. */
export async function loadHub(count: number) {
   const loaded = await loadPreload();
   const connections: any[] = [];
   loaded.chat.onConnection((connection: unknown) => connections.push(connection));
   const peers = Array.from({ length: count }, (_, index) => loaded.connect(`${index + 1}:a`));
   return { ...loaded, connections, peers };
}

/** Closes what the helpers of this module opened, and removes their project. */
export async function cleanupPortConnect() {
   for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
   }
   await project?.cleanup();
   project = undefined;
}
