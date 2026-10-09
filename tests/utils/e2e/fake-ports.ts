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

/**
 * A `MessagePortMain`: an emitter with the methods that the generated code calls, which records
 * them. A test feeds it the messages of the other end with `fromPage`, or by emitting `message`
 * (`{ data }`) and `close` itself.
 */
export class FakePortMain extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
   readonly name: string;
   constructor(name = "") {
      super();
      this.name = name;
   }
   /** The other end posts a message, which Electron reports as `{ data }`. */
   fromPage(data: unknown) {
      this.emit("message", { data });
   }
   /** What was posted to the other end, with the given `__ipc` tag, or all of it. */
   posted(tag?: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => tag === undefined || message.__ipc === tag);
   }
}

/** The channels that the generated main process made with `MessageChannelMain`, in order. */
export const channelsMade: { port1: FakePortMain; port2: FakePortMain }[] = [];

/** A `MessageChannelMain`: both ends are ports of the main process, named after their channel. */
export class FakeChannelMain {
   port1 = new FakePortMain(`port1 of ${channelsMade.length + 1}`);
   port2 = new FakePortMain(`port2 of ${channelsMade.length + 1}`);
   constructor() {
      channelsMade.push(this);
   }
}

/** The main port of the last channel that was made. */
export const lastPort = () => channelsMade[channelsMade.length - 1].port1;

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
   /** The other end posts a message to the page. */
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   /** The other end closes the port. */
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
   /** What the page posted to the other end, with the given `__ipc` tag, or all of it. */
   posted(tag?: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => tag === undefined || message.__ipc === tag);
   }
}
