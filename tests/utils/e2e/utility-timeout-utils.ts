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
import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { wire } from "@testutils/e2e/utility-process-utils.js";
import { vi } from "vitest";

/** Starts a call and watches how it settles, so that no rejection is left unhandled. */
export function track(promise: Promise<unknown>) {
   const state: { status: "pending" | "resolved" | "rejected"; value?: any } = {
      status: "pending",
   };
   promise.then(
      (value) => {
         state.status = "resolved";
         state.value = value;
      },
      (error) => {
         state.status = "rejected";
         state.value = error;
      },
   );
   return state;
}

/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;

/** Sets the `attachUtility` that `createChild` attaches the children with. */
export function setAttachChild(attach: (child: unknown) => void) {
   attachChild = attach;
}

/** Undoes what the helpers and the tests set up. Call it from `afterEach`. */
export function resetTimeoutFakes() {
   attachChild = undefined;
   vi.useRealTimers();
   Reflect.deleteProperty(process, "parentPort");
   vi.restoreAllMocks();
}

/** A `UtilityProcess` stand-in: an emitter with `postMessage`, which the main process uses. */
export function createChild() {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   attachChild?.(child);
   const posted = (channel: string) =>
      child.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((m) => m.__ipc === "call" && m.channel === wire(channel));
   const reply = (channel: string, id: number, envelope: unknown) =>
      child.emit("message", { __ipc: "reply", channel: wire(channel), id, envelope });
   return { child, posted, reply };
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
export function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   const posted = (channel: string) =>
      port.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((m) => m.__ipc === "call" && m.channel === wire(channel));
   const reply = (channel: string, id: number, envelope: unknown) =>
      port.emit("message", { data: { __ipc: "reply", channel: wire(channel), id, envelope } });
   return { port, posted, reply };
}

/** A `MessagePort` of the page: records what is posted, and delivers what the test says. */
export class FakePagePort {
   onmessage: ((event: { data: unknown }) => void) | null = null;
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
   posted(tag: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => message.__ipc === tag);
   }
}

/** Loads the generated `preload.ts` with a fake Electron, and gives the page side of the ports. */
export function loadPageBindings(preloadSource: string) {
   const fake = createFakePreloadElectron();
   loadGenerated(preloadSource, { electron: fake.electron });
   const listener = (channel: string) => {
      const found = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      return found?.[1] as (event: unknown, key: unknown) => void;
   };
   const arrive = (name: string, key = "1:utility") => {
      const port = new FakePagePort();
      listener(wire(name))({ ports: [port] }, key);
      return port;
   };
   const closeFromMain = (name: string, key: string) => listener(`${wire(name)}:close`)({}, key);
   return { api: fake.exposed.ipc, arrive, closeFromMain };
}
