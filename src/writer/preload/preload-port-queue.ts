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

/**
 * The listeners and the send queue of the port channels (see `buildPortComponents`): `notify` and
 * `subscribe` for the callbacks, and `enqueue` for a message which waits for a port.
 */
export function buildPortQueueHelpers(indents: string[]): string[] {
   const [i1, i2, i3, i4] = indents;
   return [
      "type PortListener = { callback: Function };",
      "",
      "interface PortQueue {",
      `${i1}items: any[][];`,
      `${i1}dropped: number;`,
      `${i1}warnings: number;`,
      "}",
      "",
      "interface PortConnection {",
      `${i1}api: { send: Function; on: Function; onReady: Function; onClose: Function; onOverflow: Function; close: Function };`,
      `${i1}hasPort: () => boolean;`,
      `${i1}attach: (next: MessagePort) => void;`,
      `${i1}detach: () => void;`,
      "}",
      "",
      "interface PortChannel {",
      `${i1}api: { send: Function; on: Function; onReady: Function; onClose: Function; onOverflow: Function; onConnection: Function };`,
      `${i1}pair: (key: unknown, next: MessagePort | undefined) => void;`,
      `${i1}end: (key: unknown) => void;`,
      "}",
      "",
      "function notify(listeners: Iterable<PortListener>, args: any[]) {",
      `${i1}for (const listener of [...listeners]) {`,
      `${i2}try {`,
      `${i3}listener.callback(...args);`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
      "function subscribe(listeners: Set<PortListener>, callback: Function) {",
      `${i1}const listener = { callback };`,
      `${i1}listeners.add(listener);`,
      `${i1}return { listener, dispose: () => void listeners.delete(listener) };`,
      "}",
      "",
      "function createPortQueue(): PortQueue {",
      `${i1}return { items: [], dropped: 0, warnings: 0 };`,
      "}",
      "",
      "function enqueue(queue: PortQueue, args: any[], channel: string, max: number, overflow: Function | undefined) {",
      `${i1}if (queue.items.length < max) {`,
      `${i2}queue.items.push(args);`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}const before = queue.dropped;`,
      `${i1}let action: unknown = 'dropOldest';`,
      `${i1}if (overflow) {`,
      `${i2}try {`,
      `${i3}action = overflow(args, { channel, max, dropped: before, warnings: queue.warnings });`,
      `${i3}if (action !== 'dropOldest' && action !== 'dropNewest' && action !== 'clear') {`,
      `${i4}throw new TypeError(\`The overflow callback of the channel '\${channel}' must return 'dropOldest', 'dropNewest' or 'clear'\`);`,
      `${i3}}`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i3}action = 'dropOldest';`,
      `${i2}}`,
      `${i1}}`,
      `${i1}let dropped = 1;`,
      `${i1}if (max > 0 && action === 'clear') {`,
      `${i2}dropped = queue.items.length;`,
      `${i2}queue.items.length = 0;`,
      `${i2}queue.items.push(args);`,
      `${i1}} else if (max > 0 && action === 'dropOldest') {`,
      `${i2}queue.items.shift();`,
      `${i2}queue.items.push(args);`,
      `${i1}}`,
      `${i1}queue.dropped += dropped;`,
      `${i1}if (before === 0 || Math.floor(queue.dropped / 100) > Math.floor(before / 100)) {`,
      `${i2}queue.warnings += 1;`,
      `${i2}console.warn(\`The send queue of the port channel '\${channel}' is full (maxQueue \${max}), so messages are being dropped. Dropped so far: \${queue.dropped}. Warnings so far: \${queue.warnings}.\`);`,
      `${i1}}`,
      "}",
      "",
   ];
}
