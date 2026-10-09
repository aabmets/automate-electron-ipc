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
import { vi } from "vitest";
import { FakePortMain } from "./fake-ports.js";
import { wire } from "./wire-utils.js";

/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;

/** Sets the `attachUtility` that `createChild` attaches the children with, or none. */
export function setAttachChild(attach: ((child: unknown) => void) | undefined) {
   attachChild = attach;
}

/** Forgets the `attachUtility`, and removes the `process.parentPort` that a test set up. */
export function resetUtilityProcessFakes() {
   attachChild = undefined;
   Reflect.deleteProperty(process, "parentPort");
}

/** The messages of the protocol of utility processes that a mock was asked to post. */
function postedBy(postMessage: { mock: { calls: unknown[][] } }) {
   return (tag: string, channel?: string) =>
      postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((m) => m.__ipc === tag && (channel === undefined || m.channel === wire(channel)));
}

/** A reply to a call, in the protocol of utility processes. */
const replyMessage = (channel: string, id: number, envelope: unknown) => ({
   __ipc: "reply",
   channel: wire(channel),
   id,
   envelope,
});

/**
 * A `UtilityProcess` stand-in: an emitter with `postMessage`, which the main process uses. It is
 * attached to the bindings like a child from `forkUtility`, unless `attached` is false.
 * `posted` lists what the main process posted to the child (with the given tag, and channel),
 * `emitFromChild` is a message of the child, and `reply` a reply of the child to a call.
 */
export function createChild({ attached = true } = {}) {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   if (attached) {
      attachChild?.(child);
   }
   const emitFromChild = (message: unknown) => child.emit("message", message);
   const reply = (channel: string, id: number, envelope: unknown) =>
      emitFromChild(replyMessage(channel, id, envelope));
   return { child, posted: postedBy(child.postMessage), emitFromChild, reply };
}

/**
 * A `process.parentPort` stand-in, which the code in the utility process uses. Its `message`
 * events carry `{ data, ports }`, as Electron's do. `posted` lists what the child posted to the
 * main process, `emitFromMain` is a message of the main process (with the ports it transfers),
 * `reply` a reply of the main process to a call, and `broker` hands a brokered port to the child.
 */
export function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   const emitFromMain = (data: unknown, ports: unknown[] = []) =>
      port.emit("message", { data, ports });
   const reply = (channel: string, id: number, envelope: unknown) =>
      emitFromMain(replyMessage(channel, id, envelope));
   const broker = (channel: string, key = "1:utility", brokerPort = new FakePortMain()) => {
      emitFromMain({ __ipc: "port", channel: wire(channel), key }, [brokerPort]);
      return brokerPort;
   };
   return { port, posted: postedBy(port.postMessage), emitFromMain, reply, broker };
}
