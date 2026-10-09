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

import type * as t from "@types";
import type { PreloadContext } from "./preload-bindings.js";
import { buildPortQueueHelpers } from "./preload-port-queue.js";

/**
 * `createPortChannel`, which holds the connections that this page has to a port channel. The page
 * is given only `api`. A connection is a pair of ports to one peer: the main process names it with
 * a key, so that a page can hold any number of them and a port that arrives again for a known key
 * replaces the old one, which is what a reload of the peer does. The channel outlives its ports:
 * - `onConnection` runs for every connection, at once for the ones that are there, and gets an
 *   object with `send`, `on`, `onReady`, `onClose` and `close`, which are those of the channel for
 *   this peer alone. `close` ends the connection for both pages, through the main process;
 * - `send` of a connection queues the messages until a port is there, and flushes them in order;
 * - `send` of the channel goes to every connection, and queues while there is none, for the first
 *   one that comes;
 * - every queue holds at most `maxQueue` messages. `enqueue` handles the message that does not
 *   fit: it asks the overflow callback of the connection, or else the one of the channel, which
 *   gets only the new message and answers `'dropOldest'`, `'dropNewest'` or `'clear'`. The queue
 *   is not handed over, since contextBridge copies every argument that crosses it, and a queue
 *   at its limit would be copied again for every message that is dropped. Without a callback,
 *   or when it fails, the oldest message is dropped. A queue counts the messages that it has
 *   dropped and the warnings that it has logged for good, and warns at the first drop and then
 *   at every 100th;
 * - `on`, `onReady` and `onClose` of the channel hear every connection. All of the subscribers
 *   keep their own disposers. They are wrapped here because contextBridge hands over a new proxy of
 *   a callback on every crossing, so the same function could not be found again;
 * - `onReady` runs at once if a port is there, and again for every new port;
 * - `onClose` runs when a connection ends, which the main process or the other page does. The
 *   replaced port is closed without it, since the connection goes on.
 *
 * With a serializer, a message is posted as a list of one value, which is the list of the arguments
 * as the serializer made it, and a message that arrives is deserialized the same way, so the
 * pages and the main process agree on it. A `send` that cannot be serialized throws, like the
 * other channels, when a port is there, with the code in the message (see `encodeSync`). A message that waits in the queue is serialized when the
 * queue is flushed, and one that cannot be is logged with `console.error` and dropped, like one
 * that cannot be posted. A message that cannot be deserialized is logged and dropped.
 */
export function buildPortComponents(ctx: PreloadContext): string {
   const [i1, i2, i3, i4, i5, i6] = ctx.indents;
   const serialized = ctx.usesSerializer;
   // A `send` to a port throws synchronously, and a message of the queue does not.
   const wire = (args: string, encode = "encodeValue") =>
      serialized ? `[${encode}(channel, ${args})]` : args;
   return [
      "",
      ...buildPortQueueHelpers(ctx.indents),
      "function createPortChannel(channel: string, wire: string, max: number): PortChannel {",
      `${i1}const connections = new Map<string, PortConnection>();`,
      `${i1}const queue = createPortQueue();`,
      `${i1}let overflow: Function | undefined;`,
      `${i1}const subscribers = new Set<PortListener>();`,
      `${i1}const readyListeners = new Set<PortListener>();`,
      `${i1}const closeListeners = new Set<PortListener>();`,
      `${i1}const connectionListeners = new Set<PortListener>();`,
      "",
      `${i1}const end = (key: unknown) => {`,
      `${i2}const connection = typeof key === 'string' ? connections.get(key) : undefined;`,
      `${i2}if (typeof key === 'string' && connection) {`,
      `${i3}connections.delete(key);`,
      `${i3}connection.detach();`,
      `${i2}}`,
      `${i1}};`,
      "",
      `${i1}const createConnection = (key: string): PortConnection => {`,
      `${i2}let port: MessagePort | null = null;`,
      `${i2}let ended = false;`,
      `${i2}// What the channel was asked to send while it had no connection is for the first one.`,
      `${i2}const pending: PortQueue = { items: queue.items.splice(0), dropped: 0, warnings: 0 };`,
      `${i2}let ownOverflow: Function | undefined;`,
      `${i2}const ownSubscribers = new Set<PortListener>();`,
      `${i2}const ownReadyListeners = new Set<PortListener>();`,
      `${i2}const ownCloseListeners = new Set<PortListener>();`,
      `${i2}const attach = (next: MessagePort) => {`,
      `${i3}if (port) {`,
      `${i4}port.onmessage = null;`,
      `${i4}port.close();`,
      `${i3}}`,
      `${i3}port = next;`,
      `${i3}next.onmessage = (event: MessageEvent) => {`,
      ...(serialized
         ? [
              `${i4}const args = Array.isArray(event.data) ? readArguments(channel, event.data) : undefined;`,
              `${i4}if (args) {`,
              `${i5}notify(ownSubscribers, args);`,
              `${i5}notify(subscribers, args);`,
              `${i4}}`,
           ]
         : [
              `${i4}if (Array.isArray(event.data)) {`,
              `${i5}notify(ownSubscribers, event.data);`,
              `${i5}notify(subscribers, event.data);`,
              `${i4}}`,
           ]),
      `${i3}};`,
      `${i3}next.addEventListener('close', () => {`,
      `${i4}if (port === next) {`,
      `${i5}port = null;`,
      `${i5}notify(ownCloseListeners, []);`,
      `${i5}notify(closeListeners, []);`,
      `${i4}}`,
      `${i3}});`,
      `${i3}for (const args of pending.items.splice(0)) {`,
      `${i4}try {`,
      `${i5}next.postMessage(${wire("args")});`,
      `${i4}} catch (error) {`,
      `${i5}console.error(error);`,
      `${i4}}`,
      `${i3}}`,
      `${i3}notify(ownReadyListeners, []);`,
      `${i3}notify(readyListeners, []);`,
      `${i2}};`,
      `${i2}const detach = () => {`,
      `${i3}ended = true;`,
      `${i3}pending.items.length = 0;`,
      `${i3}const current = port;`,
      `${i3}if (!current) {`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}port = null;`,
      `${i3}current.onmessage = null;`,
      `${i3}current.close();`,
      `${i3}notify(ownCloseListeners, []);`,
      `${i3}notify(closeListeners, []);`,
      `${i2}};`,
      `${i2}const api = {`,
      `${i3}send: (...args: any[]) => {`,
      `${i4}if (ended) {`,
      `${i5}return;`,
      `${i4}}`,
      `${i4}if (port) {`,
      `${i5}port.postMessage(${wire("args", "encodeSync")});`,
      `${i4}} else {`,
      `${i5}enqueue(pending, args, channel, max, ownOverflow ?? overflow);`,
      `${i4}}`,
      `${i3}},`,
      `${i3}on: (callback: Function) => subscribe(ownSubscribers, callback).dispose,`,
      `${i3}onReady: (callback: Function) => {`,
      `${i4}const { listener, dispose } = subscribe(ownReadyListeners, callback);`,
      `${i4}if (port) {`,
      `${i5}notify([listener], []);`,
      `${i4}}`,
      `${i4}return dispose;`,
      `${i3}},`,
      `${i3}onClose: (callback: Function) => subscribe(ownCloseListeners, callback).dispose,`,
      `${i3}onOverflow: (callback: Function) => {`,
      `${i4}ownOverflow = callback;`,
      `${i4}return () => {`,
      `${i5}if (ownOverflow === callback) {`,
      `${i6}ownOverflow = undefined;`,
      `${i5}}`,
      `${i4}};`,
      `${i3}},`,
      `${i3}close: () => {`,
      `${i4}if (!ended) {`,
      `${i5}ipcRenderer.send(\`\${wire}:disconnect\`, key);`,
      `${i5}end(key);`,
      `${i4}}`,
      `${i3}},`,
      `${i2}};`,
      `${i2}return { api, hasPort: () => port !== null, attach, detach };`,
      `${i1}};`,
      "",
      `${i1}const pair = (key: unknown, next: MessagePort | undefined) => {`,
      `${i2}if (typeof key !== 'string' || !next) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const known = connections.get(key);`,
      `${i2}if (known) {`,
      `${i3}known.attach(next);`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const connection = createConnection(key);`,
      `${i2}connections.set(key, connection);`,
      `${i2}connection.attach(next);`,
      `${i2}notify(connectionListeners, [connection.api]);`,
      `${i1}};`,
      "",
      `${i1}const api = {`,
      `${i2}send: (...args: any[]) => {`,
      `${i3}if (connections.size === 0) {`,
      `${i4}enqueue(queue, args, channel, max, overflow);`,
      `${i3}} else {`,
      `${i4}for (const connection of [...connections.values()]) {`,
      `${i5}connection.api.send(...args);`,
      `${i4}}`,
      `${i3}}`,
      `${i2}},`,
      `${i2}on: (callback: Function) => subscribe(subscribers, callback).dispose,`,
      `${i2}onReady: (callback: Function) => {`,
      `${i3}const { listener, dispose } = subscribe(readyListeners, callback);`,
      `${i3}if ([...connections.values()].some((connection) => connection.hasPort())) {`,
      `${i4}notify([listener], []);`,
      `${i3}}`,
      `${i3}return dispose;`,
      `${i2}},`,
      `${i2}onClose: (callback: Function) => subscribe(closeListeners, callback).dispose,`,
      `${i2}onOverflow: (callback: Function) => {`,
      `${i3}overflow = callback;`,
      `${i3}return () => {`,
      `${i4}if (overflow === callback) {`,
      `${i5}overflow = undefined;`,
      `${i4}}`,
      `${i3}};`,
      `${i2}},`,
      `${i2}onConnection: (callback: Function) => {`,
      `${i3}const { listener, dispose } = subscribe(connectionListeners, callback);`,
      `${i3}for (const connection of [...connections.values()]) {`,
      `${i4}notify([listener], [connection.api]);`,
      `${i3}}`,
      `${i3}return dispose;`,
      `${i2}},`,
      `${i1}};`,
      `${i1}return { api, pair, end };`,
      "}",
      "",
      "const ports: { [channel: string]: PortChannel } = { __proto__: null } as any;",
      "",
   ].join("\n");
}

/** Creates the channel, and hands it the ports and the ends of the connections when they arrive. */
export function buildPortInitializer(ctx: PreloadContext, spec: t.ChannelSpec): string {
   const [i1] = ctx.indents;
   const portName = spec.name;
   return [
      `ports['${portName}'] = createPortChannel('${portName}', ${ctx.wireName(portName)}, ${ctx.getMaxQueue(spec)});`,
      `ipcRenderer.on(${ctx.wireName(portName)}, (event: IpcRendererEvent, key: unknown) => {`,
      `${i1}ports['${portName}'].pair(key, event.ports[0]);`,
      "});",
      `ipcRenderer.on(${ctx.wireName(portName, ":close")}, (_event: IpcRendererEvent, key: unknown) => {`,
      `${i1}ports['${portName}'].end(key);`,
      "});",
   ].join("\n");
}
