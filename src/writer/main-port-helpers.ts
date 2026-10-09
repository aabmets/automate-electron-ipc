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

import type { MainContext } from "./main-bindings.js";

/** The helpers of the `mainPort` channels, whose one end is in the main process. */

/**
 * `connectMainPort`, which `ipc.<name>.connect` of a `mainPort` channel calls, and
 * `configurePorts`, which sets the overflow callback that the send queues use by default. The main process
 * keeps one end of a `MessageChannelMain` and transfers the other to the page, with the key of
 * the connection. It pairs once the page has loaded (see `watchPageLoad`), since a port that is
 * posted earlier arrives before the preload script listens for it, and again whenever a page loads, so a page that
 * reloads gets a fresh port, and the old port is dropped without ending the connection. The
 * connection has the shape of the one that a page gets from `onConnection`:
 * - `send` queues the messages until a port is there, and flushes them in order. The queue holds
 *   at most `maxQueue` messages. A message that does not fit goes to the overflow callback of
 *   the connection, or else to the global one of `configurePorts`, with a copy of the queue, the
 *   message and the counts. The callback returns the messages to keep, the oldest are dropped if
 *   there are too many, and it is the oldest message that is dropped without a callback, and
 *   when the callback fails. The first drop is logged with `console.warn`, then every 100th;
 * - `on`, `onReady` and `onClose` keep any number of subscribers with their own disposers, and a
 *   subscriber which throws is reported to `console.error` and does not stop the others;
 * - `onReady` runs at once if a port is there, and again for every new port;
 * - `onClose` runs when the port closes, such as when the page goes away, and when `close` ends
 *   the connection. `close` is final: the page is told through `<channel>:close`, the port is
 *   closed and a reload pairs no more. The connection also ends when the contents are destroyed,
 *   and when the page asks for it.
 *
 * With a serializer, a message is posted as a list of one value, which is the list of the arguments
 * as the serializer made it, and a message that arrives is deserialized the same way. A `send`
 * that cannot be serialized throws an `IpcSerializationError` when a port is there. A message that
 * waits in the queue is serialized when the queue is flushed, and one that cannot be is logged
 * with `console.error` and dropped, like one that cannot be posted. A message that cannot be
 * deserialized is logged and dropped.
 */
export function buildMainPortHelpers(ctx: MainContext): string {
   const [i1, i2, i3, i4, i5] = ctx.indents;
   const serialized = ctx.usesSerializer;
   const wire = (args: string) => (serialized ? `[encodeValue(name, ${args})]` : args);
   return [
      "",
      "export interface PortOverflowInfo {",
      `${i1}channel: string;`,
      `${i1}max: number;`,
      `${i1}dropped: number;`,
      `${i1}warnings: number;`,
      "}",
      "",
      "export interface PortsConfig {",
      `${i1}onOverflow?: (queue: unknown[][], message: unknown[], info: PortOverflowInfo) => unknown[][];`,
      "}",
      "",
      "let portsConfig: PortsConfig = {};",
      "",
      "export function configurePorts(config: PortsConfig): void {",
      `${i1}portsConfig = { onOverflow: config.onOverflow };`,
      "}",
      "",
      "interface MainPortConnection {",
      `${i1}send: (...args: any[]) => void;`,
      `${i1}on: (callback: Function) => () => void;`,
      `${i1}onReady: (callback: () => void) => () => void;`,
      `${i1}onClose: (callback: () => void) => () => void;`,
      `${i1}onOverflow: (callback: Function | undefined) => () => void;`,
      `${i1}close: () => void;`,
      "}",
      "",
      "type MainPortListener = { callback: Function };",
      "",
      "interface MainPortQueue {",
      `${i1}items: unknown[][];`,
      `${i1}dropped: number;`,
      `${i1}warnings: number;`,
      "}",
      "",
      "function enqueueMainPort(",
      `${i1}queue: MainPortQueue,`,
      `${i1}args: unknown[],`,
      `${i1}channel: string,`,
      `${i1}max: number,`,
      `${i1}overflow: Function | undefined,`,
      "): void {",
      `${i1}if (queue.items.length < max) {`,
      `${i2}queue.items.push(args);`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}const before = queue.dropped;`,
      `${i1}let kept: unknown[][] | undefined;`,
      `${i1}if (overflow) {`,
      `${i2}try {`,
      `${i3}const result = overflow([...queue.items], args, { channel, max, dropped: before, warnings: queue.warnings });`,
      `${i3}if (!Array.isArray(result) || !result.every((item) => Array.isArray(item))) {`,
      `${i4}throw new TypeError(\`The overflow callback of the channel '\${channel}' must return an array of messages\`);`,
      `${i3}}`,
      `${i3}kept = result;`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}}`,
      `${i1}if (!kept) {`,
      `${i2}kept = max > 0 ? [...queue.items.slice(1), args] : [];`,
      `${i1}}`,
      `${i1}// The oldest messages that do not fit, and the waiting ones and the new one that were left out.`,
      `${i1}const truncated = Math.max(0, kept.length - max);`,
      `${i1}queue.dropped += truncated + Math.max(0, queue.items.length + 1 - kept.length);`,
      `${i1}queue.items = kept.slice(truncated);`,
      `${i1}if (before === 0 || Math.floor(queue.dropped / 100) > Math.floor(before / 100)) {`,
      `${i2}queue.warnings += 1;`,
      `${i2}console.warn(\`The send queue of the port channel '\${channel}' is full (maxQueue \${max}), so messages are being dropped. Dropped so far: \${queue.dropped}. Warnings so far: \${queue.warnings}.\`);`,
      `${i1}}`,
      "}",
      "",
      "function notifyMainPortListeners(listeners: Iterable<MainPortListener>, args: unknown[]): void {",
      `${i1}for (const listener of [...listeners]) {`,
      `${i2}try {`,
      `${i3}listener.callback(...args);`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
      "function addMainPortListener(listeners: Set<MainPortListener>, callback: Function) {",
      `${i1}const listener = { callback };`,
      `${i1}listeners.add(listener);`,
      `${i1}return { listener, dispose: () => void listeners.delete(listener) };`,
      "}",
      "",
      "function connectMainPort(",
      `${i1}channel: string,`,
      `${i1}name: string,`,
      `${i1}max: number,`,
      `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
      "): MainPortConnection {",
      `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
      `${i1}// Contents that are destroyed already would never emit 'destroyed', which leaves the entry behind.`,
      `${i1}if (contents.isDestroyed()) {`,
      `${i2}throw new TypeError('Object has been destroyed');`,
      `${i1}}`,
      `${i1}const key = \`\${++lastPortConnectionId}:main\`;`,
      `${i1}const subscribers = new Set<MainPortListener>();`,
      `${i1}const readyListeners = new Set<MainPortListener>();`,
      `${i1}const closeListeners = new Set<MainPortListener>();`,
      `${i1}const pending: MainPortQueue = { items: [], dropped: 0, warnings: 0 };`,
      `${i1}let ownOverflow: Function | undefined;`,
      `${i1}let port: MessagePortMain | null = null;`,
      `${i1}let closed = false;`,
      `${i1}const watch = watchPageLoad(contents, () => pair());`,
      `${i1}let unwatchDestroyed = (): void => undefined;`,
      `${i1}const isReady = () => !contents.isDestroyed() && watch.isLoaded();`,
      `${i1}// Drops the port without ending the connection, which is what a new port replaces.`,
      `${i1}const release = () => {`,
      `${i2}const current = port;`,
      `${i2}port = null;`,
      `${i2}current?.close();`,
      `${i2}return current;`,
      `${i1}};`,
      `${i1}const attach = (next: MessagePortMain) => {`,
      `${i2}release();`,
      `${i2}port = next;`,
      `${i2}next.on('message', (event: { data: unknown }) => {`,
      ...(serialized
         ? [
              `${i3}if (port === next && Array.isArray(event.data)) {`,
              `${i4}const args = readSentArguments(name, event.data);`,
              `${i4}if (args) {`,
              `${i5}notifyMainPortListeners(subscribers, args);`,
              `${i4}}`,
              `${i3}}`,
           ]
         : [
              `${i3}if (port === next && Array.isArray(event.data)) {`,
              `${i4}notifyMainPortListeners(subscribers, event.data);`,
              `${i3}}`,
           ]),
      `${i2}});`,
      `${i2}next.on('close', () => {`,
      `${i3}if (port === next) {`,
      `${i4}port = null;`,
      `${i4}notifyMainPortListeners(closeListeners, []);`,
      `${i3}}`,
      `${i2}});`,
      `${i2}next.start();`,
      `${i2}for (const args of pending.items.splice(0)) {`,
      `${i3}try {`,
      `${i4}next.postMessage(${wire("args")});`,
      `${i3}} catch (error) {`,
      `${i4}console.error(error);`,
      `${i3}}`,
      `${i2}}`,
      `${i2}notifyMainPortListeners(readyListeners, []);`,
      `${i1}};`,
      `${i1}const pair = () => {`,
      `${i2}if (closed || !isReady()) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const { port1, port2 } = new MessageChannelMain();`,
      `${i2}attach(port1);`,
      `${i2}contents.postMessage(channel, key, [port2]);`,
      `${i1}};`,
      `${i1}const close = () => {`,
      `${i2}if (closed) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}closed = true;`,
      `${i2}pending.items.length = 0;`,
      `${i2}portEnds.delete(key);`,
      `${i2}watch.dispose();`,
      `${i2}unwatchDestroyed();`,
      `${i2}// Destroyed contents cannot be reached.`,
      `${i2}if (!contents.isDestroyed()) {`,
      `${i3}contents.send(\`\${channel}:close\`, key);`,
      `${i2}}`,
      `${i2}if (release()) {`,
      `${i3}notifyMainPortListeners(closeListeners, []);`,
      `${i2}}`,
      `${i1}};`,
      `${i1}// A failure from here on undoes what was registered, since the caller never gets the connection.`,
      `${i1}try {`,
      `${i2}portEnds.set(key, { contents, close });`,
      `${i2}listenForPortDisconnects(channel);`,
      `${i2}unwatchDestroyed = watchEvent(contents, 'destroyed', close);`,
      `${i2}pair();`,
      `${i1}} catch (error) {`,
      `${i2}close();`,
      `${i2}throw error;`,
      `${i1}}`,
      `${i1}return {`,
      `${i2}send: (...args: any[]) => {`,
      `${i3}if (closed) {`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}if (port) {`,
      `${i4}port.postMessage(${wire("args")});`,
      `${i3}} else {`,
      `${i4}enqueueMainPort(pending, args, name, max, ownOverflow ?? portsConfig.onOverflow);`,
      `${i3}}`,
      `${i2}},`,
      `${i2}on: (callback: Function) => addMainPortListener(subscribers, callback).dispose,`,
      `${i2}onReady: (callback: () => void) => {`,
      `${i3}const { listener, dispose } = addMainPortListener(readyListeners, callback);`,
      `${i3}if (port) {`,
      `${i4}notifyMainPortListeners([listener], []);`,
      `${i3}}`,
      `${i3}return dispose;`,
      `${i2}},`,
      `${i2}onClose: (callback: () => void) => addMainPortListener(closeListeners, callback).dispose,`,
      `${i2}onOverflow: (callback: Function | undefined) => {`,
      `${i3}ownOverflow = callback;`,
      `${i3}return () => {`,
      `${i4}if (ownOverflow === callback) {`,
      `${i5}ownOverflow = undefined;`,
      `${i4}}`,
      `${i3}};`,
      `${i2}},`,
      `${i2}close,`,
      `${i1}};`,
      "}",
      "",
   ].join("\n");
}
