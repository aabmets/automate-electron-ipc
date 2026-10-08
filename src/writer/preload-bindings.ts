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
import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";

interface ChannelEntry {
   name: string;
   /** The property of the exposed object, starting with a newline. */
   property: string;
}

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.preloadBindingsFilePath;
   }
   protected renderEmptyFileContents(): string {
      return [
         'import { contextBridge } from "electron";\n',
         "contextBridge.exposeInMainWorld('ipc', {});",
      ].join("\n");
   }
   protected renderFileContents(): string {
      const portNamesArray: string[] = [];
      const askNames: string[] = [];
      const channels: ChannelEntry[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               channels.push(this.buildRendererToMainChannel(spec));
            } else if (spec.direction === "MainToRenderer") {
               if (spec.kind === "Unicast") {
                  askNames.push(spec.name);
               }
               channels.push(this.buildMainToRendererChannel(spec));
            } else if (spec.direction === "RendererToRenderer") {
               portNamesArray.push(spec.name);
               channels.push({
                  name: spec.name,
                  property: `\n${this.indents[0]}${spec.name}: ports['${spec.name}'].api,`,
               });
            }
         }
      }
      const out: string[] = ['import { contextBridge, ipcRenderer } from "electron";'];
      if (portNamesArray.length > 0) {
         out.push(
            'import type { IpcRendererEvent } from "electron";',
            this.getPortComponents(),
            ...portNamesArray
               .sort(utils.compareStrings)
               .map((portName) => this.getPortInitializer(portName)),
         );
      }
      if (askNames.length > 0) {
         out.push(
            this.buildAskComponents(),
            ...askNames.sort(utils.compareStrings).map((askName) => this.buildAskListener(askName)),
         );
      }
      const bindingsExpression = ["\ncontextBridge.exposeInMainWorld('ipc', {"];
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(channel.property);
      }
      bindingsExpression.push("\n});\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }

   /**
    * `ipc.<name>.invoke(...args)` for `invoke` channels and `ipc.<name>.send(...args)` for `send`.
    * An invoke gets the envelope of the main process: it returns the value of a successful reply
    * and rejects with the error object of a failed one. It rejects with the plain object
    * `{ name, message, code?, data? }`, not with an `Error`, since contextBridge copies a thrown
    * `Error` as a new `Error` with only the message and the stack, and loses the other fields.
    */
   private buildRendererToMainChannel(spec: t.ChannelSpec): ChannelEntry {
      const method = spec.kind === "Broadcast" ? "send" : "invoke";
      const ipcRenderer = `ipcRenderer.${method}(${this.wireName(spec.name)}, ...args)`;
      if (spec.kind === "Unicast" && !this.config.rawErrors) {
         const [, i1, i2, i3] = this.indents;
         const implementation = [
            "async (...args: any[]) => {",
            `${i2}const result = await ${ipcRenderer};`,
            `${i2}if (result.ok) {`,
            `${i3}return result.value;`,
            `${i2}}`,
            `${i2}throw result.error;`,
            `${i1}}`,
         ].join("\n");
         return this.buildChannel(spec.name, method, implementation);
      }
      return this.buildChannel(spec.name, method, `(...args: any[]) => ${ipcRenderer}`);
   }

   /**
    * `ipc.<name>.on(callback)` and `ipc.<name>.once(callback)`. The wrapper that is registered with
    * `ipcRenderer` is created here, in the preload script, because contextBridge hands over a new
    * proxy of the callback on every crossing, so a separate `off(callback)` could not find it. Each
    * method returns a function which removes that one wrapper. The callback never sees the event,
    * and the return value is not `ipcRenderer`, which must not leak into the page.
    */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const [i0, i1, i2, i3] = this.indents;
      if (spec.kind === "Unicast") {
         return this.buildAskChannel(spec);
      }
      const subscribe = (method: "on" | "once") =>
         [
            `${i1}${method}: (callback: Function) => {`,
            `${i2}const listener = (_event: any, ...args: any[]) => callback(...args);`,
            `${i2}ipcRenderer.${method}(${this.wireName(spec.name)}, listener);`,
            `${i2}return () => {`,
            `${i3}ipcRenderer.removeListener(${this.wireName(spec.name)}, listener);`,
            `${i2}};`,
            `${i1}},`,
         ].join("\n");
      const methods = [subscribe("on"), subscribe("once")].join("\n");
      return { name: spec.name, property: `\n${i0}${spec.name}: {\n${methods}\n${i0}},` };
   }

   /**
    * `ipc.<name>.handle(callback)` of an `ask` channel, the single responder to the questions of
    * the main process. A new responder replaces the previous one, and the function that `handle`
    * returns removes only its own, so that the disposer of a replaced responder does nothing.
    */
   private buildAskChannel(spec: t.ChannelSpec): ChannelEntry {
      const [i0, i1, i2, i3, i4] = this.indents;
      const name = `'${spec.name}'`;
      const lines = [
         `${i1}handle: (callback: Function) => {`,
         `${i2}askHandlers[${name}] = callback;`,
         `${i2}return () => {`,
         `${i3}if (askHandlers[${name}] === callback) {`,
         `${i4}delete askHandlers[${name}];`,
         `${i3}}`,
         `${i2}};`,
         `${i1}},`,
      ];
      return { name: spec.name, property: `\n${i0}${spec.name}: {\n${lines.join("\n")}\n${i0}},` };
   }

   /**
    * The answering side of the `ask` channels. The responders live here, in the preload script,
    * since contextBridge hands over a new proxy of a callback on every crossing. A question is
    * answered with the envelope of the `invoke` channels, `{ ok: true, value }` or
    * `{ ok: false, error }`, and with the error code `IPC_ASK_NO_HANDLER` when no responder is
    * registered, so that the main process does not wait for nothing. A responder which throws is
    * reduced to `{ name, message, code?, data? }`, like the handler of an `invoke`. contextBridge
    * keeps only the message of an `Error` that the page throws, so a responder which wants its
    * `code` and `data` to arrive throws a plain object. An answer that cannot be cloned is
    * replaced by an error, since it would otherwise never arrive.
    */
   private buildAskComponents(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         "interface IpcErrorInfo {",
         `${i1}name: string;`,
         `${i1}message: string;`,
         `${i1}code?: string | number;`,
         `${i1}data?: unknown;`,
         "}",
         "",
         "type IpcEnvelope = { ok: true; value: unknown } | { ok: false; error: IpcErrorInfo };",
         "",
         "const askHandlers: { [channel: string]: Function | undefined } = { __proto__: null } as any;",
         "",
         "function toIpcError(error: unknown): IpcErrorInfo {",
         `${i1}try {`,
         `${i2}const source = typeof error === 'object' && error !== null ? (error as { [key: string]: unknown }) : null;`,
         `${i2}const name = source && typeof source.name === 'string' && source.name ? source.name : 'Error';`,
         `${i2}const message = source && typeof source.message === 'string' ? source.message : String(error);`,
         `${i2}const info: IpcErrorInfo = { name, message };`,
         `${i2}if (source && (typeof source.code === 'string' || typeof source.code === 'number')) {`,
         `${i3}info.code = source.code;`,
         `${i2}}`,
         `${i2}if (source && source.data !== undefined) {`,
         `${i3}try {`,
         `${i4}info.data = structuredClone(source.data);`,
         `${i3}} catch {`,
         `${i4}// Data that cannot be cloned is left out.`,
         `${i3}}`,
         `${i2}}`,
         `${i2}return info;`,
         `${i1}} catch {`,
         `${i2}return { name: 'Error', message: 'The handler failed with an unreadable error' };`,
         `${i1}}`,
         "}",
         "",
         "async function answerAsk(",
         `${i1}channel: string,`,
         `${i1}reply: string,`,
         `${i1}id: unknown,`,
         `${i1}args: any[],`,
         "): Promise<void> {",
         `${i1}const handler = askHandlers[channel];`,
         `${i1}let envelope: IpcEnvelope;`,
         `${i1}if (!handler) {`,
         `${i2}const message = \`No handler is registered for the channel '\${channel}'\`;`,
         `${i2}envelope = { ok: false, error: { name: 'IpcAskError', message, code: 'IPC_ASK_NO_HANDLER' } };`,
         `${i1}} else {`,
         `${i2}try {`,
         `${i3}envelope = { ok: true, value: await handler(...args) };`,
         `${i2}} catch (error) {`,
         `${i3}envelope = { ok: false, error: toIpcError(error) };`,
         `${i2}}`,
         `${i1}}`,
         `${i1}try {`,
         `${i2}ipcRenderer.send(reply, id, envelope);`,
         `${i1}} catch (error) {`,
         `${i2}const message = \`The answer of the channel '\${channel}' cannot be sent: \${toIpcError(error).message}\`;`,
         `${i2}ipcRenderer.send(reply, id, { ok: false, error: { name: 'IpcAskError', message, code: 'IPC_ASK_UNSENDABLE' } });`,
         `${i1}}`,
         "}",
         "",
      ].join("\n");
   }

   private buildAskListener(name: string): string {
      const [, i1] = this.indents;
      return [
         `ipcRenderer.on(${this.wireName(name)}, (_event: unknown, id: unknown, ...args: any[]) => {`,
         `${i1}void answerAsk('${name}', ${this.wireName(name, ":reply")}, id, args);`,
         "});",
         "",
      ].join("\n");
   }

   private buildChannel(name: string, method: string, implementation: string): ChannelEntry {
      const [i0, i1] = this.indents;
      return { name, property: `\n${i0}${name}: {\n${i1}${method}: ${implementation},\n${i0}},` };
   }

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
    * - `on`, `onReady` and `onClose` of the channel hear every connection. All of the subscribers
    *   keep their own disposers. They are wrapped here because contextBridge hands over a new proxy of
    *   a callback on every crossing, so the same function could not be found again;
    * - `onReady` runs at once if a port is there, and again for every new port;
    * - `onClose` runs when a connection ends, which the main process or the other page does. The
    *   replaced port is closed without it, since the connection goes on.
    */
   private getPortComponents(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      return [
         "",
         "type PortListener = { callback: Function };",
         "",
         "interface PortConnection {",
         `${i1}api: { send: Function; on: Function; onReady: Function; onClose: Function; close: Function };`,
         `${i1}hasPort: () => boolean;`,
         `${i1}attach: (next: MessagePort) => void;`,
         `${i1}detach: () => void;`,
         "}",
         "",
         "interface PortChannel {",
         `${i1}api: { send: Function; on: Function; onReady: Function; onClose: Function; onConnection: Function };`,
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
         "function createPortChannel(wire: string): PortChannel {",
         `${i1}const connections = new Map<string, PortConnection>();`,
         `${i1}const queue: any[][] = [];`,
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
         `${i2}const pending: any[][] = queue.splice(0);`,
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
         `${i4}if (Array.isArray(event.data)) {`,
         `${i5}notify(ownSubscribers, event.data);`,
         `${i5}notify(subscribers, event.data);`,
         `${i4}}`,
         `${i3}};`,
         `${i3}next.addEventListener('close', () => {`,
         `${i4}if (port === next) {`,
         `${i5}port = null;`,
         `${i5}notify(ownCloseListeners, []);`,
         `${i5}notify(closeListeners, []);`,
         `${i4}}`,
         `${i3}});`,
         `${i3}for (const args of pending.splice(0)) {`,
         `${i4}try {`,
         `${i5}next.postMessage(args);`,
         `${i4}} catch (error) {`,
         `${i5}console.error(error);`,
         `${i4}}`,
         `${i3}}`,
         `${i3}notify(ownReadyListeners, []);`,
         `${i3}notify(readyListeners, []);`,
         `${i2}};`,
         `${i2}const detach = () => {`,
         `${i3}ended = true;`,
         `${i3}pending.length = 0;`,
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
         `${i5}port.postMessage(args);`,
         `${i4}} else {`,
         `${i5}pending.push(args);`,
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
         `${i4}queue.push(args);`,
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
   private getPortInitializer(portName: string): string {
      const [i1] = this.indents;
      return [
         `ports['${portName}'] = createPortChannel(${this.wireName(portName)});`,
         `ipcRenderer.on(${this.wireName(portName)}, (event: IpcRendererEvent, key: unknown) => {`,
         `${i1}ports['${portName}'].pair(key, event.ports[0]);`,
         "});",
         `ipcRenderer.on(${this.wireName(portName, ":close")}, (_event: IpcRendererEvent, key: unknown) => {`,
         `${i1}ports['${portName}'].end(key);`,
         "});",
      ].join("\n");
   }
}
