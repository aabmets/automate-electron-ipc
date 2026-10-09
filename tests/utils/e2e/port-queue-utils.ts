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
import { closeWire, wire } from "./wire-utils.js";

let project: E2EProject;

/** Generates the fixture of a test file, which the loaders of the page and of the main process read. */
export async function loadBoundedProject() {
   project = await runFixture("bounded-ports");
   return project;
}

/** The messages of the calls, such as `[["a"], ["b"]]` for `send("a")` and `send("b")`. */
export const messages = (mock: { mock: { calls: unknown[][] } }) =>
   mock.mock.calls.map(([message]) => message);

/** Sends `count` messages `<prefix>1`, `<prefix>2`, ... with `send`. */
export function sendMany(send: (...args: unknown[]) => void, count: number, prefix = "m") {
   for (let index = 1; index <= count; index++) {
      send(`${prefix}${index}`);
   }
}

/** The list `[[prefix + from], ..., [prefix + to]]` that `sendMany` would have queued. */
export function range(from: number, to: number, prefix = "m") {
   return Array.from({ length: to - from + 1 }, (_, index) => [`${prefix}${from + index}`]);
}

/** A `MessagePort` of the page, as the preload script uses it. */
export class FakePagePort {
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   onmessage: unknown = null;
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   /** The other end closes the port. */
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
}

/** Loads the generated preload script, and returns what it exposes and how to feed it ports. */
export function loadPage() {
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (name: string) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === name,
      );
      return call?.[1] as (...args: unknown[]) => void;
   };
   /** Hands the page a port of the connection with the key, which is the main process's job. */
   const pair = (channel: string, key = "1:main") => {
      const port = new FakePagePort();
      listener(wire(channel))({ ports: [port] }, key);
      return port;
   };
   const end = (channel: string, key = "1:main") => listener(closeWire(channel))({}, key);
   return { ipc: fake.exposed.ipc, pair, end };
}

/** The messages that a port was asked to post, in order. */
export const posted = (port: FakePagePort) => messages(port.postMessage);

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent. */
export function createContents(loading = false) {
   const contents = Object.assign(new EventEmitter(), {
      loading,
      destroyed: false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => "app://.",
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}
export class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
}

export const channelsMade: { port1: FakePortMain; port2: object }[] = [];

export class FakeChannelMain {
   port1 = new FakePortMain();
   port2 = {};
   constructor() {
      channelsMade.push(this);
   }
}

/** Loads the generated main process, and returns its exports. */
export function loadMain() {
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannelMain };
   return loadGenerated(project.generated["main.ts"], { electron });
}

export const lastPort = () => channelsMade[channelsMade.length - 1].port1;
export const flushed = () => messages(lastPort().postMessage);

/** A connection of `channel` whose page has not loaded, so that `send` queues. */
export function connectWaiting(main: any, channel: string) {
   const contents = createContents(true);
   const connection = main.ipc[channel].connect(contents);
   return { contents, connection };
}
