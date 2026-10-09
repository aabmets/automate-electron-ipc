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

export interface ChannelEntry {
   name: string;
   /** The property of the exposed object, starting with a newline. */
   property: string;
}

/** The channels of the page, by the components that they need. */
export interface ChannelGroups {
   portSpecs: t.ChannelSpec[];
   askNames: string[];
   streamSpecs: t.ChannelSpec[];
   brokeredSpecs: t.ChannelSpec[];
   /** Whether a channel has `on` and `once`, which share `subscribe`. */
   subscribed: boolean;
   channels: ChannelEntry[];
}

/**
 * The `getPathForFile` helper of the API. `File.path` is gone since Electron 32, and the path of a
 * file that the page holds is known only to the preload script. `webUtils` is available in a
 * sandboxed preload, and contextBridge hands the `File` of the page over as it is.
 */
const PATH_FOR_FILE = "(file: File): string => webUtils.getPathForFile(file)";

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.getScopedFilePath(this.config.preloadBindingsFilePath);
   }
   protected isEmpty(): boolean {
      return !this.hasRendererChannels();
   }
   /**
    * The page takes no part in the traffic between the main process and a utility process, or a
    * service worker. The worker script has its channels mapped to those of a page first.
    */
   protected isSerializedSpec(spec: t.ChannelSpec): boolean {
      return !(this.isUtilitySpec(spec) || this.isWorkerSpec(spec)) && super.isSerializedSpec(spec);
   }
   protected renderEmptyFileContents(): string {
      const [i0] = this.indents;
      const bridge = this.getPathForFileEnabled() ? "contextBridge, webUtils" : "contextBridge";
      const api = this.getPathForFileEnabled()
         ? `export const api = {\n${i0}getPathForFile: ${PATH_FOR_FILE},\n};`
         : "export const api = {};";
      return [`import { ${bridge} } from "electron";\n`, api, ""]
         .concat(this.buildExpose())
         .join("\n");
   }
   protected renderFileContents(): string {
      const groups = this.groupChannels();
      const out = this.buildComponents(groups);
      if (this.getPathForFileEnabled()) {
         groups.channels.push({
            name: "getPathForFile",
            property: `\n${this.indents[0]}getPathForFile: ${PATH_FOR_FILE},`,
         });
      }
      const bindingsExpression = ["\nexport const api = {"];
      for (const channel of this.sortChannels(groups.channels)) {
         bindingsExpression.push(channel.property);
      }
      bindingsExpression.push("\n};\n");

      out.push(bindingsExpression.join(""), ...this.buildExpose(), "");
      return out.join("\n");
   }

   /**
    * `expose(key)`, which exposes `api` under the key: in the main world by default, or in the
    * isolated world of the config. The key defaults to `exposeAs`. The call of `expose()` that
    * follows is left out when `autoExpose` is off, so that the app's own preload code can decide
    * when and under which keys to expose the API.
    */
   private buildExpose(): string[] {
      const [i1] = this.indents;
      const worldId = this.getWorldId();
      const call =
         worldId === undefined
            ? "contextBridge.exposeInMainWorld(key, api);"
            : `contextBridge.exposeInIsolatedWorld(${worldId}, key, api);`;
      const out = [
         `export function expose(key = '${this.getExposeAs()}'): void {`,
         `${i1}${call}`,
         "}",
      ];
      if (this.getAutoExpose()) {
         out.push("", "expose();");
      }
      return out;
   }

   /** The isolated world that the API is exposed in, or `undefined` for the main world. */
   protected getWorldId(): number | undefined {
      return this.config.isolatedWorldId;
   }

   /** Sorts the channels of the page into the groups that need components of their own. */
   protected groupChannels(): ChannelGroups {
      const groups: ChannelGroups = {
         portSpecs: [],
         askNames: [],
         streamSpecs: [],
         brokeredSpecs: [],
         subscribed: false,
         channels: [],
      };
      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of this.getRendererSpecs(parsedFileSpecs)) {
            this.groupChannel(spec, groups);
         }
      }
      return groups;
   }

   protected groupChannel(spec: t.ChannelSpec, groups: ChannelGroups): void {
      const { portSpecs, askNames, streamSpecs, brokeredSpecs, channels } = groups;
      if (spec.kind === "Port") {
         // The page has the same API for both peers: another page, or the main process.
         portSpecs.push(spec);
         channels.push({
            name: spec.name,
            property: `\n${this.indents[0]}${spec.name}: ports['${spec.name}'].api,`,
         });
      } else if (this.isBrokeredSpec(spec)) {
         brokeredSpecs.push(spec);
         channels.push(this.buildBrokeredChannel(spec));
      } else if (spec.kind === "Stream") {
         streamSpecs.push(spec);
         channels.push(this.buildStreamChannel(spec));
      } else if (spec.direction === "RendererToMain") {
         channels.push(this.buildRendererToMainChannel(spec));
      } else if (spec.direction === "MainToRenderer") {
         if (spec.kind === "Unicast") {
            askNames.push(spec.name);
         } else {
            groups.subscribed = true;
         }
         channels.push(this.buildMainToRendererChannel(spec));
      }
   }

   /** The code above the exposed object: the imports, and the components that the channels use. */
   private buildComponents(groups: ChannelGroups): string[] {
      const { portSpecs, askNames, streamSpecs, brokeredSpecs } = groups;
      const imports = this.getPathForFileEnabled()
         ? "contextBridge, ipcRenderer, webUtils"
         : "contextBridge, ipcRenderer";
      const out: string[] = [`import { ${imports} } from "electron";`];
      if (this.hasSerializedChannels()) {
         out.push(this.buildSerializerImport());
      }
      if (portSpecs.length > 0) {
         out.push(
            'import type { IpcRendererEvent } from "electron";',
            this.getPortComponents(),
            ...portSpecs
               .sort((a, b) => utils.compareStrings(a.name, b.name))
               .map((spec) => this.getPortInitializer(spec)),
         );
      }
      if (this.hasSerializedChannels()) {
         out.push(this.buildSerializerComponents());
      }
      if (groups.subscribed) {
         out.push(this.buildSubscriptionComponents());
      }
      out.push(...this.getTimeoutComponents());
      if (askNames.length > 0 || streamSpecs.length > 0 || brokeredSpecs.length > 0) {
         out.push(this.buildErrorComponents());
      }
      if (streamSpecs.length > 0 || this.hasBrokeredStreams(brokeredSpecs)) {
         out.push(this.buildStreamReader());
      }
      if (askNames.length > 0) {
         out.push(
            this.buildAskComponents(),
            ...askNames.sort(utils.compareStrings).map((askName) => this.buildAskListener(askName)),
         );
      }
      if (streamSpecs.length > 0) {
         out.push(
            this.buildStreamComponents(),
            ...streamSpecs
               .sort((a, b) => utils.compareStrings(a.name, b.name))
               .map((spec) => this.buildStreamListener(spec.name)),
            "",
         );
      }
      if (brokeredSpecs.length > 0) {
         out.push(...this.buildUtilityClient(brokeredSpecs));
      }
      return out;
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
      const serialized = this.isSerializedSpec(spec);
      // A `send` throws synchronously, so its failure must carry the code in the message.
      const encode = spec.kind === "Broadcast" ? "encodeSync" : "encodeValue";
      const sent = serialized ? `${encode}('${spec.name}', args)` : "...args";
      let ipcRenderer = `ipcRenderer.${method}(${this.wireName(spec.name)}, ${sent})`;
      if (this.hasTimeout(spec)) {
         ipcRenderer = `withTimeout('${spec.name}', ${this.getTimeoutMs(spec)}, ${ipcRenderer})`;
      }
      const decode = (value: string) =>
         serialized ? `decodeValue('${spec.name}', ${value})` : value;
      if (spec.kind === "Unicast" && !this.config.rawErrors) {
         const [, i1, i2, i3] = this.indents;
         const implementation = [
            "async (...args: any[]) => {",
            `${i2}const result = await ${ipcRenderer};`,
            `${i2}if (result.ok) {`,
            `${i3}return ${decode("result.value")};`,
            `${i2}}`,
            `${i2}throw result.error;`,
            `${i1}}`,
         ].join("\n");
         return this.buildChannel(spec.name, method, implementation);
      }
      if (serialized && spec.kind === "Unicast") {
         // A synchronous failure to serialize must reject the promise, not throw.
         const implementation = `async (...args: any[]) => ${decode(`await ${ipcRenderer}`)}`;
         return this.buildChannel(spec.name, method, implementation);
      }
      return this.buildChannel(spec.name, method, `(...args: any[]) => ${ipcRenderer}`);
   }

   /**
    * The helpers of the serializer, which the channels between this page and the main process use:
    * `encodeValue` turns what is sent into the wire value, and `decodeValue` turns what arrives
    * back. The arguments of a call go as one value, the list of them, which `decodeArguments`
    * checks. A failure is a plain object `{ name: 'IpcSerializationError', message, code:
    * 'IPC_SERIALIZATION' }`, since contextBridge does not keep the fields of an `Error`. That holds
    * for a promise that rejects with it. What a function throws synchronously, as the `send` of a
    * channel does, reaches the page as an `Error` with the message only, whatever was thrown, so
    * `encodeSync` puts the code in the message, as `[IPC_SERIALIZATION] ...`. A message
    * from the main process that cannot be read is logged and dropped, and so is not thrown into
    * the code of Electron.
    */
   private buildSerializerComponents(): string {
      const [i1, i2] = this.indents;
      return [
         "",
         "function serializationError(channel: string, what: string, cause: unknown) {",
         `${i1}const reason = cause instanceof Error ? cause.message : String(cause);`,
         `${i1}return { name: 'IpcSerializationError', message: \`\${what} of the channel '\${channel}': \${reason}\`, code: 'IPC_SERIALIZATION' };`,
         "}",
         "",
         "function encodeValue(channel: string, value: unknown): unknown {",
         `${i1}try {`,
         `${i2}return (ipcSerialize as (value: unknown) => unknown)(value);`,
         `${i1}} catch (cause) {`,
         `${i2}throw serializationError(channel, 'The data cannot be serialized', cause);`,
         `${i1}}`,
         "}",
         "",
         "function encodeSync(channel: string, value: unknown): unknown {",
         `${i1}try {`,
         `${i2}return encodeValue(channel, value);`,
         `${i1}} catch (error: any) {`,
         `${i2}throw { ...error, message: \`[\${error.code}] \${error.message}\` };`,
         `${i1}}`,
         "}",
         "",
         "function decodeValue(channel: string, wire: unknown): unknown {",
         `${i1}try {`,
         `${i2}return (ipcDeserialize as (wire: unknown) => unknown)(wire);`,
         `${i1}} catch (cause) {`,
         `${i2}throw serializationError(channel, 'The data cannot be deserialized', cause);`,
         `${i1}}`,
         "}",
         "",
         "function decodeArguments(channel: string, received: unknown[]): any[] {",
         `${i1}const value = received.length === 1 ? decodeValue(channel, received[0]) : undefined;`,
         `${i1}if (!Array.isArray(value)) {`,
         `${i2}throw serializationError(channel, 'The arguments are not a list', 'the message has an unknown shape');`,
         `${i1}}`,
         `${i1}return value;`,
         "}",
         "",
         "function readArguments(channel: string, received: unknown[]): any[] | undefined {",
         `${i1}try {`,
         `${i2}return decodeArguments(channel, received);`,
         `${i1}} catch (error) {`,
         `${i2}console.error(error);`,
         `${i2}return undefined;`,
         `${i1}}`,
         "}",
      ].join("\n");
   }

   /** `withTimeout`, if any channel needs it. */
   private getTimeoutComponents(): string[] {
      const used = this.pfsArray.some((parsed) =>
         parsed.specs.channelSpecArray.some((spec) => this.hasTimeout(spec)),
      );
      return used ? [this.buildTimeoutComponents()] : [];
   }

   /** Whether the promise of an `invoke` channel is rejected after a timeout. */
   private hasTimeout(spec: t.ChannelSpec): boolean {
      return (
         spec.kind === "Unicast" &&
         spec.direction === "RendererToMain" &&
         this.getTimeoutMs(spec) > 0
      );
   }

   /**
    * `withTimeout`, which races the promise of an `ipcRenderer.invoke` against a timer. When the
    * timer wins, the promise of the page is rejected with the plain object
    * `{ name: 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' }`, like the other errors of the
    * library, since contextBridge does not keep the fields of an `Error`. The handler in the main
    * process cannot be stopped, and its late reply is dropped. The timer is cleared as soon as the
    * reply arrives, and does not keep the delay above what a timer can hold.
    */
   private buildTimeoutComponents(): string {
      const [i1, i2, i3] = this.indents;
      return [
         "",
         "function withTimeout<T>(channel: string, timeoutMs: number, call: Promise<T>): Promise<T> {",
         `${i1}return new Promise<T>((resolve, reject) => {`,
         `${i2}const timer = setTimeout(() => {`,
         `${i3}const message = \`The channel '\${channel}' did not answer within \${timeoutMs} ms\`;`,
         `${i3}reject({ name: 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' });`,
         `${i2}}, Math.min(timeoutMs, 2147483647));`,
         `${i2}call.then(`,
         `${i3}(value) => {`,
         `${i3}${i1}clearTimeout(timer);`,
         `${i3}${i1}resolve(value);`,
         `${i3}},`,
         `${i3}(error: unknown) => {`,
         `${i3}${i1}clearTimeout(timer);`,
         `${i3}${i1}reject(error);`,
         `${i3}},`,
         `${i2});`,
         `${i1}});`,
         "}",
         "",
      ].join("\n");
   }

   /**
    * `ipc.<name>.on(callback)` and `ipc.<name>.once(callback)`. The subscription is created here,
    * in the preload script, because contextBridge hands over a new proxy of the callback on every
    * crossing, so a separate `off(callback)` could not find it. Each method returns a function
    * which removes that one subscription. The callback never sees the event, and the return value
    * is not `ipcRenderer`, which must not leak into the page. The subscriptions of a channel share
    * one `ipcRenderer` listener (see `buildSubscriptionComponents`).
    */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const [i0, i1, i2] = this.indents;
      if (spec.kind === "Unicast") {
         return this.buildAskChannel(spec);
      }
      const read = this.isSerializedSpec(spec)
         ? `, (received: any[]) => readArguments('${spec.name}', received)`
         : "";
      const subscribe = (method: "on" | "once") =>
         [
            `${i1}${method}: (callback: Function) => {`,
            `${i2}return listenToChannel(${this.wireName(spec.name)}, callback, ${method === "once"}${read});`,
            `${i1}},`,
         ].join("\n");
      const methods = [subscribe("on"), subscribe("once")].join("\n");
      return { name: spec.name, property: `\n${i0}${spec.name}: {\n${methods}\n${i0}},` };
   }

   /**
    * `listenToChannel(channel, callback, once, read?)`, which `on` and `once` of the channels use. Each
    * subscription used to add an `ipcRenderer` listener of its own, and Node warns about more than
    * ten listeners of the same event (`MaxListenersExceededWarning`), which is no reason to refuse an
    * eleventh subscriber of a channel. So a channel has one `ipcRenderer` listener with the
    * subscribers behind it, which is added with the first subscriber and removed with the last.
    * - `read` turns the arguments of a message into the list that the callbacks get, once per
    *   message, or into nothing for a message that cannot be read. Then no callback runs, and a
    *   `once` subscriber stays;
    * - a subscriber is called in the order of subscription, and a `once` subscriber is removed
    *   before its callback runs, so that a message it causes cannot reach it again;
    * - a callback which unsubscribes any subscriber during a dispatch keeps that one from being
    *   called by it, and a subscriber which is added during a dispatch gets the next message;
    * - a callback which throws is logged and does not keep the others from running;
    * - the function it returns removes that one subscription, also when the callback is the same
    *   as another one, and does nothing when it is called again.
    */
   private buildSubscriptionComponents(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      return [
         "",
         "interface ChannelSubscriber {",
         `${i1}callback: Function;`,
         `${i1}once: boolean;`,
         "}",
         "",
         "interface ChannelSubscription {",
         `${i1}subscribers: ChannelSubscriber[];`,
         `${i1}listener: (_event: unknown, ...received: any[]) => void;`,
         "}",
         "",
         "const channelSubscriptions: { [channel: string]: ChannelSubscription | undefined } = { __proto__: null } as any;",
         "",
         "function listenToChannel(",
         `${i1}channel: string,`,
         `${i1}callback: Function,`,
         `${i1}once: boolean,`,
         `${i1}read?: (received: any[]) => any[] | undefined,`,
         "): () => void {",
         `${i1}let subscription = channelSubscriptions[channel];`,
         `${i1}if (!subscription) {`,
         `${i2}const subscribers: ChannelSubscriber[] = [];`,
         `${i2}const listener = (_event: unknown, ...received: any[]) => {`,
         `${i3}const args = read ? read(received) : received;`,
         `${i3}if (!args) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}for (const next of subscribers.slice()) {`,
         `${i4}if (subscribers.indexOf(next) < 0) {`,
         `${i5}continue;`,
         `${i4}}`,
         `${i4}if (next.once) {`,
         `${i5}unlistenToChannel(channel, next);`,
         `${i4}}`,
         `${i4}try {`,
         `${i5}next.callback(...args);`,
         `${i4}} catch (error) {`,
         `${i5}console.error(error);`,
         `${i4}}`,
         `${i3}}`,
         `${i2}};`,
         `${i2}subscription = { subscribers, listener };`,
         `${i2}channelSubscriptions[channel] = subscription;`,
         `${i2}ipcRenderer.on(channel, listener);`,
         `${i1}}`,
         `${i1}const subscriber: ChannelSubscriber = { callback, once };`,
         `${i1}subscription.subscribers.push(subscriber);`,
         `${i1}return () => unlistenToChannel(channel, subscriber);`,
         "}",
         "",
         "function unlistenToChannel(channel: string, subscriber: ChannelSubscriber): void {",
         `${i1}const subscription = channelSubscriptions[channel];`,
         `${i1}const at = subscription ? subscription.subscribers.indexOf(subscriber) : -1;`,
         `${i1}if (!subscription || at < 0) {`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}subscription.subscribers.splice(at, 1);`,
         `${i1}if (subscription.subscribers.length === 0) {`,
         `${i2}delete channelSubscriptions[channel];`,
         `${i2}ipcRenderer.removeListener(channel, subscription.listener);`,
         `${i1}}`,
         "}",
      ].join("\n");
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
    * `IpcErrorInfo`, `IpcEnvelope` and `toIpcError`, which the `ask` and `stream` channels share. An
    * error that the page's code or the transport raised is reduced to `{ name, message, code?, data? }`
    * like the handler of an `invoke` is, and the `data` that cannot be cloned is left out.
    */
   private buildErrorComponents(): string {
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
      ].join("\n");
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
      const [i1, i2, i3] = this.indents;
      return [
         "",
         "const askHandlers: { [channel: string]: Function | undefined } = { __proto__: null } as any;",
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
         `${i3}envelope = { ok: true, value: ${
            this.usesSerializer()
               ? "encodeValue(channel, await handler(...decodeArguments(channel, args)))"
               : "await handler(...args)"
         } };`,
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

   /**
    * `ipc.<name>.stream(...args)` of a `stream` channel, which returns the stream: an async
    * iterator of the chunks, with `cancel()`. The page cannot pass an `AbortSignal`, which
    * `contextBridge` copies as an empty object, so cancelling is `cancel()`, `return()` or the
    * `break` of a `for await` loop.
    */
   private buildStreamChannel(spec: t.ChannelSpec): ChannelEntry {
      const implementation = `(...args: any[]) => openStream('${spec.name}', ${this.wireName(spec.name)}, args, ${this.getHighWaterMark(spec)})`;
      return this.buildChannel(spec.name, "stream", implementation);
   }

   /**
    * `createStreamReader`, which the streams of the page share, whichever transport they use. It
    * makes the stream that the page gets, an async iterator of the chunks with `cancel()`. The
    * page gets no `ipcRenderer`, only the object with `next`, `return`, `cancel` and
    * `Symbol.asyncIterator`. The transport feeds it with `push` and ends it with `finish`:
    * - chunks are queued until the page reads them, and a read resolves in order, also when the
    *   page asks for several chunks at once;
    * - the flow is controlled by credits (see `startStream` in the main process). The sender may
    *   send `highWaterMark` chunks that are not read yet, and the reader grants more through
    *   `grant(limit)`, with the total number of chunks that it allows so far: the chunks it has
    *   read, plus the window, which is at least the number of reads that wait. It does so once
    *   half a window has been read, so that a fast reader costs one message per half window and the
    *   queue does not run dry in the meantime. `grant` returns false when the transport cannot send
    *   yet, and then the grant is made later, by `topUp()`, which the transport calls when it can.
    *   A reader that stops reading without cancelling holds at most the window in memory.
    *   `Infinity` never grants, and the sender is not slowed down;
    * - `finish()` closes the stream after the queued chunks, and `finish({ error })` does so by
    *   rejecting a read with the error object, once the queued chunks have been read, as a plain
    *   object, since contextBridge does not keep the fields of an `Error`;
    * - `cancel` (and `return`, which a `break` calls) tells the other side through `cancelRemote`,
    *   drops the chunks that are queued, and finishes the stream. `stop` runs once, when it finishes.
    */
   private buildStreamReader(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "type StreamResult = { done: boolean; value: unknown };",
         "",
         "function createStreamReader(stop: () => void, cancelRemote: () => void, highWaterMark: number, grant: (limit: number) => boolean) {",
         `${i1}const chunks: unknown[] = [];`,
         `${i1}const waiters: { resolve: (result: StreamResult) => void; reject: (error: unknown) => void }[] = [];`,
         `${i1}let finished = false;`,
         `${i1}let failure: { error: unknown } | null = null;`,
         `${i1}let consumed = 0;`,
         `${i1}let granted = highWaterMark;`,
         `${i1}const topUp = () => {`,
         `${i2}if (finished || highWaterMark === Infinity) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}const wanted = consumed + Math.max(highWaterMark, waiters.length);`,
         `${i2}if (wanted - granted >= Math.max(1, Math.ceil(highWaterMark / 2)) && grant(wanted)) {`,
         `${i3}granted = wanted;`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const flush = () => {`,
         `${i2}while (waiters.length > 0) {`,
         `${i3}const waiter = waiters[0];`,
         `${i3}if (chunks.length > 0) {`,
         `${i4}waiters.shift();`,
         `${i4}consumed += 1;`,
         `${i4}waiter.resolve({ done: false, value: chunks.shift() });`,
         `${i3}} else if (!finished) {`,
         `${i4}return;`,
         `${i3}} else if (failure) {`,
         `${i4}const { error } = failure;`,
         `${i4}failure = null;`,
         `${i4}waiters.shift();`,
         `${i4}waiter.reject(error);`,
         `${i3}} else {`,
         `${i4}waiters.shift();`,
         `${i4}waiter.resolve({ done: true, value: undefined });`,
         `${i3}}`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const drain = () => {`,
         `${i2}flush();`,
         `${i2}topUp();`,
         `${i1}};`,
         `${i1}const finish = (error?: { error: unknown }) => {`,
         `${i2}if (finished) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}finished = true;`,
         `${i2}failure = error ?? null;`,
         `${i2}stop();`,
         `${i2}drain();`,
         `${i1}};`,
         `${i1}const cancel = () => {`,
         `${i2}if (finished) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}try {`,
         `${i3}cancelRemote();`,
         `${i2}} catch {`,
         `${i3}// The other side is gone, which stops the stream as well.`,
         `${i2}}`,
         `${i2}chunks.length = 0;`,
         `${i2}finish();`,
         `${i1}};`,
         `${i1}const stream = {`,
         `${i2}next: () =>`,
         `${i3}new Promise<StreamResult>((resolve, reject) => {`,
         `${i4}waiters.push({ resolve, reject });`,
         `${i4}drain();`,
         `${i3}}),`,
         `${i2}return: () => {`,
         `${i3}cancel();`,
         `${i3}return Promise.resolve({ done: true, value: undefined });`,
         `${i2}},`,
         `${i2}cancel,`,
         `${i2}[Symbol.asyncIterator]: () => stream,`,
         `${i1}};`,
         `${i1}const push = (value: unknown) => {`,
         `${i2}if (!finished) {`,
         `${i3}chunks.push(value);`,
         `${i3}drain();`,
         `${i2}}`,
         `${i1}};`,
         `${i1}return { stream, push, finish, topUp, isFinished: () => finished };`,
         "}",
         "",
      ].join("\n");
   }

   /**
    * `openStream`, which starts a call of a `stream` channel and returns its stream (see
    * `createStreamReader`). The call is `ipcRenderer.invoke(wire, id, ...args)`: its envelope reports a
    * failure to start (a rejected sender, invalid arguments, no handler, a handler that throws before
    * it yields) and the main process hands over the port of the call, with the same `id`, on
    * `<wire>:port`. Then:
    * - `chunk`, `end` and `error` messages of the port feed the reader;
    * - a cancel tells the main process, which calls `return()` on the generator, closes the port and
    *   drops the chunks that are queued. A port that arrives after the cancel is closed;
    * - a port that closes before `end` fails the stream with the code `IPC_STREAM_CLOSED`.
    */
   private buildStreamComponents(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      return [
         "const streamPorts: { [id: number]: ((port: MessagePort | undefined) => void) | undefined } = { __proto__: null } as any;",
         "let lastStreamId = 0;",
         "",
         "function openStream(channel: string, wire: string, args: any[], highWaterMark: number) {",
         `${i1}const id = ++lastStreamId;`,
         `${i1}let port: MessagePort | null = null;`,
         `${i1}const reader = createStreamReader(`,
         `${i2}() => {`,
         `${i3}delete streamPorts[id];`,
         `${i3}const current = port;`,
         `${i3}port = null;`,
         `${i3}if (current) {`,
         `${i4}current.onmessage = null;`,
         `${i4}current.close();`,
         `${i3}}`,
         `${i2}},`,
         `${i2}() => port?.postMessage({ type: 'cancel' }),`,
         `${i2}highWaterMark,`,
         `${i2}(limit) => {`,
         `${i3}if (!port) {`,
         `${i4}return false;`,
         `${i3}}`,
         `${i3}try {`,
         `${i4}port.postMessage({ type: 'credit', limit });`,
         `${i4}return true;`,
         `${i3}} catch {`,
         `${i4}return false;`,
         `${i3}}`,
         `${i2}},`,
         `${i1});`,
         `${i1}streamPorts[id] = (next) => {`,
         `${i2}if (!next) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (reader.isFinished()) {`,
         `${i3}next.close();`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}port = next;`,
         `${i2}next.onmessage = (event: MessageEvent) => {`,
         `${i3}const message = event.data as { type?: unknown; value?: unknown; error?: unknown } | null;`,
         `${i3}if (reader.isFinished() || !message) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}if (message.type === 'chunk') {`,
         ...(this.usesSerializer()
            ? [
                 `${i4}try {`,
                 `${i5}reader.push(decodeValue(channel, message.value));`,
                 `${i4}} catch (error) {`,
                 `${i5}reader.finish({ error });`,
                 `${i4}}`,
              ]
            : [`${i4}reader.push(message.value);`]),
         `${i3}} else if (message.type === 'end') {`,
         `${i4}reader.finish();`,
         `${i3}} else if (message.type === 'error') {`,
         `${i4}reader.finish({ error: message.error });`,
         `${i3}}`,
         `${i2}};`,
         `${i2}next.addEventListener('close', () => {`,
         `${i3}if (port === next) {`,
         `${i4}const message = \`The stream of the channel '\${channel}' was closed before it ended\`;`,
         `${i4}reader.finish({ error: { name: 'IpcStreamError', message, code: 'IPC_STREAM_CLOSED' } });`,
         `${i3}}`,
         `${i2}});`,
         `${i2}// Reads that were made before the port arrived have not granted anything yet.`,
         `${i2}reader.topUp();`,
         `${i1}};`,
         `${i1}const unreadable = { name: 'IpcStreamError', message: \`The main process sent an unreadable reply to the channel '\${channel}'\`, code: 'IPC_STREAM_INVALID_REPLY' };`,
         `${i1}try {`,
         `${i2}ipcRenderer.invoke(wire, id, ${this.usesSerializer() ? "encodeValue(channel, args)" : "...args"}).then(`,
         `${i3}(result: IpcEnvelope | undefined) => {`,
         `${i4}if (!result || !result.ok) {`,
         `${i5}reader.finish({ error: result && result.error ? result.error : unreadable });`,
         `${i4}}`,
         `${i3}},`,
         `${i3}(error: unknown) => reader.finish({ error: toIpcError(error) }),`,
         `${i2});`,
         `${i1}} catch (error) {`,
         `${i2}reader.finish({ error: toIpcError(error) });`,
         `${i1}}`,
         `${i1}return reader.stream;`,
         "}",
         "",
         "function listenForStreamPorts(portWire: string): void {",
         `${i1}ipcRenderer.on(portWire, (event: { ports: MessagePort[] }, id: unknown) => {`,
         `${i2}const attach = typeof id === 'number' ? streamPorts[id] : undefined;`,
         `${i2}if (attach) {`,
         `${i3}attach(event.ports[0]);`,
         `${i2}} else {`,
         `${i3}event.ports[0]?.close();`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
      ].join("\n");
   }

   /** Whether any of the channels to a utility process is a `streamUtility` channel. */
   private hasBrokeredStreams(specs: t.ChannelSpec[]): boolean {
      return specs.some((spec) => spec.kind === "Stream");
   }

   /** The client of the channels to a utility process, and the listeners for the ports of the channels. */
   private buildUtilityClient(specs: t.ChannelSpec[]): string[] {
      return [
         this.buildUtilityClientComponents(this.hasBrokeredStreams(specs)),
         ...specs
            .sort((a, b) => utils.compareStrings(a.name, b.name))
            .map((spec) => this.buildUtilityClientListener(spec.name)),
         "",
      ];
   }

   /**
    * `ipc.<name>.invoke(...args)` of an `invokeUtility` channel and `ipc.<name>.stream(...args)` of
    * a `streamUtility` channel, which talk to the utility process over the port that the main
    * process brokers (see `buildUtilityClientComponents`).
    */
   private buildBrokeredChannel(spec: t.ChannelSpec): ChannelEntry {
      const client = `utilityClients['${spec.name}']`;
      if (spec.kind === "Stream") {
         return this.buildChannel(
            spec.name,
            "stream",
            `(...args: any[]) => openUtilityStream(${client}, args, ${this.getHighWaterMark(spec)}${this.getTimeoutArgument(spec)})`,
         );
      }
      return this.buildChannel(
         spec.name,
         "invoke",
         `(...args: any[]) => callUtilityPort(${client}, args${this.getTimeoutArgument(spec)})`,
      );
   }

   /**
    * The client of the channels between this page and a utility process. The main process hands
    * the page one port per channel, on the channel itself, with the key of the connection, and the
    * port goes straight to the child. The client is the same for calls and streams:
    * - a call or a stream made before the port has arrived waits for it, in order, and is started
    *   when it comes. One made after the connection has closed is rejected at once with
    *   `IPC_UTILITY_EXITED`, since the process is gone;
    * - a call posts `{ __ipc: 'call', channel, id, args }` and is answered by `reply` with the
    *   envelope of the `invoke` channels. A stream posts `stream` and is fed by `chunk`, `end`
    *   and `error` messages of the same ID, all of one port, `credit` (see `createStreamReader`)
    *   lets the child send more, and `cancel` stops it in the child;
    * - a port that arrives for the channel replaces the one it has, and the calls and streams that
    *   were open on the old one fail with `IPC_UTILITY_EXITED`. The main process closes the
    *   connection through `<channel>:close` with the key, which ignores any other key. The close of
    *   the port itself, such as when the process exits, ends it as well;
    * - errors are plain objects `{ name, message, code, data? }`, since contextBridge does not keep
    *   the fields of an `Error`. The ones of the library are `IpcUtilityError`, with the codes
    *   `IPC_UTILITY_EXITED`, `_UNSENDABLE`, `_INVALID_REPLY` and `_TIMEOUT`;
    * - with a `timeoutMs`, a call that has had no reply, or a stream that has sent no chunk, end or
    *   error, by then is rejected with `IPC_UTILITY_TIMEOUT`. The timer starts when the page makes
    *   the call, so it covers the wait for the port too. The handler in the child is not stopped
    *   and its late reply is dropped, but a timed-out stream is cancelled in the child. A stream
    *   that has begun is not cut short, since a slow reader holds the generator back on purpose.
    * - with a serializer, the arguments of a call or a stream go as a list of one value, the list
    *   of them as the serializer made it, and the value of a reply and every chunk are deserialized.
    *   Arguments that cannot be serialized reject the call, or fail the stream, at once with the plain
    *   object `{ name: 'IpcSerializationError', message, code: 'IPC_SERIALIZATION' }`, as does a
    *   value that cannot be deserialized; a chunk of that kind also cancels the stream in the child.
    * Messages that are not the library's, or are for another channel or ID, are ignored.
    */
   private buildUtilityClientComponents(streams: boolean): string {
      const [i1, i2, i3, i4] = this.indents;
      const serialized = this.usesSerializer();
      return [
         "",
         "interface UtilityClient {",
         `${i1}name: string;`,
         `${i1}channel: string;`,
         `${i1}port: MessagePort | null;`,
         `${i1}key: string | null;`,
         `${i1}closed: boolean;`,
         `${i1}waiting: (() => void)[];`,
         `${i1}calls: Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>;`,
         `${i1}streams: Map<number, { push: (value: unknown) => void; finish: (error?: { error: unknown }) => void }>;`,
         "}",
         "",
         "let lastUtilityCallId = 0;",
         "const utilityClients: { [channel: string]: UtilityClient } = { __proto__: null } as any;",
         "",
         "function utilityError(message: string, code: string) {",
         `${i1}return { name: 'IpcUtilityError', message, code };`,
         "}",
         "",
         "function createUtilityClient(name: string, channel: string): UtilityClient {",
         `${i1}return { name, channel, port: null, key: null, closed: false, waiting: [], calls: new Map(), streams: new Map() };`,
         "}",
         "",
         "function dropUtilityPort(client: UtilityClient, reason: string): void {",
         `${i1}const port = client.port;`,
         `${i1}client.port = null;`,
         `${i1}client.key = null;`,
         `${i1}client.closed = true;`,
         `${i1}if (port) {`,
         `${i2}port.onmessage = null;`,
         `${i2}port.close();`,
         `${i1}}`,
         `${i1}const calls = [...client.calls.values()];`,
         `${i1}const streams = [...client.streams.values()];`,
         `${i1}client.calls.clear();`,
         `${i1}client.streams.clear();`,
         `${i1}const message = \`\${reason} before the channel '\${client.name}' was answered\`;`,
         `${i1}for (const call of calls) {`,
         `${i2}call.reject(utilityError(message, 'IPC_UTILITY_EXITED'));`,
         `${i1}}`,
         `${i1}for (const stream of streams) {`,
         `${i2}stream.finish({ error: utilityError(message, 'IPC_UTILITY_EXITED') });`,
         `${i1}}`,
         "}",
         "",
         "function receiveFromUtility(client: UtilityClient, message: unknown): void {",
         `${i1}const source = typeof message === 'object' && message !== null ? (message as { [key: string]: unknown }) : null;`,
         `${i1}if (!source || source.channel !== client.channel || typeof source.id !== 'number') {`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}const id = source.id;`,
         `${i1}if (source.__ipc === 'reply') {`,
         `${i2}const call = client.calls.get(id);`,
         `${i2}if (!call) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}client.calls.delete(id);`,
         `${i2}const envelope = typeof source.envelope === 'object' && source.envelope !== null ? (source.envelope as { [key: string]: unknown }) : null;`,
         `${i2}if (envelope && envelope.ok === true) {`,
         ...(serialized
            ? [
                 `${i3}try {`,
                 `${i4}call.resolve(decodeValue(client.name, envelope.value));`,
                 `${i3}} catch (error) {`,
                 `${i4}call.reject(error);`,
                 `${i3}}`,
              ]
            : [`${i3}call.resolve(envelope.value);`]),
         `${i2}} else if (envelope && envelope.ok === false && typeof envelope.error === 'object' && envelope.error !== null) {`,
         `${i3}call.reject(toIpcError(envelope.error));`,
         `${i2}} else {`,
         `${i3}call.reject(utilityError(\`The utility process sent an unreadable reply to the channel '\${client.name}'\`, 'IPC_UTILITY_INVALID_REPLY'));`,
         `${i2}}`,
         `${i1}} else {`,
         `${i2}const stream = client.streams.get(id);`,
         `${i2}if (!stream) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (source.__ipc === 'chunk') {`,
         ...(serialized
            ? [
                 `${i3}try {`,
                 `${i4}stream.push(decodeValue(client.name, source.value));`,
                 `${i3}} catch (error) {`,
                 `${i4}// The stream cannot go on, and the child is told to stop it.`,
                 `${i4}try {`,
                 `${i4}${i1}client.port?.postMessage({ __ipc: 'cancel', channel: client.channel, id });`,
                 `${i4}} catch {`,
                 `${i4}${i1}// The port is gone, which stops the stream in the child as well.`,
                 `${i4}}`,
                 `${i4}stream.finish({ error: toIpcError(error) });`,
                 `${i3}}`,
              ]
            : [`${i3}stream.push(source.value);`]),
         `${i2}} else if (source.__ipc === 'end') {`,
         `${i3}stream.finish();`,
         `${i2}} else if (source.__ipc === 'error') {`,
         `${i3}stream.finish({ error: toIpcError(source.error) });`,
         `${i2}}`,
         `${i1}}`,
         "}",
         "",
         "function attachUtilityPort(client: UtilityClient, key: string, port: MessagePort): void {",
         `${i1}if (client.port) {`,
         `${i2}dropUtilityPort(client, 'The connection was replaced');`,
         `${i1}}`,
         `${i1}client.port = port;`,
         `${i1}client.key = key;`,
         `${i1}client.closed = false;`,
         `${i1}port.onmessage = (event: MessageEvent) => receiveFromUtility(client, event.data);`,
         `${i1}port.addEventListener('close', () => {`,
         `${i2}if (client.port === port) {`,
         `${i3}dropUtilityPort(client, 'The connection closed');`,
         `${i2}}`,
         `${i1}});`,
         `${i1}for (const start of client.waiting.splice(0)) {`,
         `${i2}start();`,
         `${i1}}`,
         "}",
         "",
         "function callUtilityPort(client: UtilityClient, args: any[], timeoutMs = 0): Promise<unknown> {",
         `${i1}return new Promise<unknown>((resolve, reject) => {`,
         `${i2}if (client.closed) {`,
         `${i3}reject(utilityError(\`The utility process of the channel '\${client.name}' is gone\`, 'IPC_UTILITY_EXITED'));`,
         `${i3}return;`,
         `${i2}}`,
         ...(serialized
            ? [
                 `${i2}let wired: unknown[];`,
                 `${i2}try {`,
                 `${i3}wired = [encodeValue(client.name, args)];`,
                 `${i2}} catch (error) {`,
                 `${i3}reject(error);`,
                 `${i3}return;`,
                 `${i2}}`,
              ]
            : []),
         `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
         `${i2}let settled = false;`,
         `${i2}let id = 0;`,
         `${i2}const settle = (finish: () => void) => {`,
         `${i3}if (!settled) {`,
         `${i4}settled = true;`,
         `${i4}clearTimeout(timer);`,
         `${i4}finish();`,
         `${i3}}`,
         `${i2}};`,
         `${i2}const start = () => {`,
         `${i3}if (settled) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}id = ++lastUtilityCallId;`,
         `${i3}client.calls.set(id, { resolve: (value) => settle(() => resolve(value)), reject: (error) => settle(() => reject(error)) });`,
         `${i3}try {`,
         `${i4}client.port?.postMessage({ __ipc: 'call', channel: client.channel, id, ${serialized ? "args: wired" : "args"} });`,
         `${i3}} catch (error) {`,
         `${i4}client.calls.delete(id);`,
         `${i4}settle(() => reject(utilityError(\`A call of the channel '\${client.name}' cannot be sent: \${toIpcError(error).message}\`, 'IPC_UTILITY_UNSENDABLE')));`,
         `${i3}}`,
         `${i2}};`,
         `${i2}if (timeoutMs > 0) {`,
         `${i3}// The timer covers the wait for the port too. The handler in the child is not stopped, and its late reply is dropped.`,
         `${i3}timer = setTimeout(() => {`,
         `${i4}client.calls.delete(id);`,
         `${i4}settle(() => reject(utilityError(\`The channel '\${client.name}' did not answer within \${timeoutMs} ms\`, 'IPC_UTILITY_TIMEOUT')));`,
         `${i3}}, Math.min(timeoutMs, 2147483647));`,
         `${i2}}`,
         `${i2}if (client.port) {`,
         `${i3}start();`,
         `${i2}} else {`,
         `${i3}client.waiting.push(start);`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
         ...(streams
            ? [
                 "function openUtilityStream(client: UtilityClient, args: any[], highWaterMark: number, timeoutMs = 0) {",
                 `${i1}const id = ++lastUtilityCallId;`,
                 `${i1}let timer: ReturnType<typeof setTimeout> | undefined;`,
                 `${i1}const reader = createStreamReader(`,
                 `${i2}() => {`,
                 `${i3}clearTimeout(timer);`,
                 `${i3}client.streams.delete(id);`,
                 `${i2}},`,
                 `${i2}() => client.port?.postMessage({ __ipc: 'cancel', channel: client.channel, id }),`,
                 `${i2}highWaterMark,`,
                 `${i2}(limit) => {`,
                 `${i3}if (!client.port || !client.streams.has(id)) {`,
                 `${i4}return false;`,
                 `${i3}}`,
                 `${i3}try {`,
                 `${i4}client.port.postMessage({ __ipc: 'credit', channel: client.channel, id, limit });`,
                 `${i4}return true;`,
                 `${i3}} catch {`,
                 `${i4}return false;`,
                 `${i3}}`,
                 `${i2}},`,
                 `${i1});`,
                 ...(serialized
                    ? [
                         `${i1}let wired: unknown[];`,
                         `${i1}try {`,
                         `${i2}wired = [encodeValue(client.name, args)];`,
                         `${i1}} catch (error) {`,
                         `${i2}reader.finish({ error: toIpcError(error) });`,
                         `${i2}return reader.stream;`,
                         `${i1}}`,
                      ]
                    : []),
                 `${i1}const start = () => {`,
                 `${i2}if (reader.isFinished()) {`,
                 `${i3}return;`,
                 `${i2}}`,
                 `${i2}client.streams.set(id, {`,
                 `${i3}push: (value) => {`,
                 `${i4}clearTimeout(timer);`,
                 `${i4}reader.push(value);`,
                 `${i3}},`,
                 `${i3}finish: reader.finish,`,
                 `${i2}});`,
                 `${i2}try {`,
                 `${i3}client.port?.postMessage({ __ipc: 'stream', channel: client.channel, id, ${serialized ? "args: wired" : "args"} });`,
                 `${i3}reader.topUp();`,
                 `${i2}} catch (error) {`,
                 `${i3}reader.finish({ error: utilityError(\`A call of the channel '\${client.name}' cannot be sent: \${toIpcError(error).message}\`, 'IPC_UTILITY_UNSENDABLE') });`,
                 `${i2}}`,
                 `${i1}};`,
                 `${i1}if (timeoutMs > 0) {`,
                 `${i2}// The wait for the first chunk, the end or an error. A stream that has begun is not cut short, since a reader that is slow holds the generator back on purpose.`,
                 `${i2}timer = setTimeout(() => {`,
                 `${i3}try {`,
                 `${i4}client.port?.postMessage({ __ipc: 'cancel', channel: client.channel, id });`,
                 `${i3}} catch {`,
                 `${i4}// The port is gone, which stops the stream in the child as well.`,
                 `${i3}}`,
                 `${i3}reader.finish({ error: utilityError(\`The channel '\${client.name}' did not answer within \${timeoutMs} ms\`, 'IPC_UTILITY_TIMEOUT') });`,
                 `${i2}}, Math.min(timeoutMs, 2147483647));`,
                 `${i1}}`,
                 `${i1}if (client.closed) {`,
                 `${i2}reader.finish({ error: utilityError(\`The utility process of the channel '\${client.name}' is gone\`, 'IPC_UTILITY_EXITED') });`,
                 `${i1}} else if (client.port) {`,
                 `${i2}start();`,
                 `${i1}} else {`,
                 `${i2}client.waiting.push(start);`,
                 `${i1}}`,
                 `${i1}return reader.stream;`,
                 "}",
                 "",
              ]
            : []),
         "function listenForUtilityPorts(name: string, channel: string): void {",
         `${i1}const client = createUtilityClient(name, channel);`,
         `${i1}utilityClients[name] = client;`,
         `${i1}ipcRenderer.on(channel, (event: { ports: MessagePort[] }, key: unknown) => {`,
         `${i2}const port = event.ports[0];`,
         `${i2}if (typeof key === 'string' && port) {`,
         `${i3}attachUtilityPort(client, key, port);`,
         `${i2}} else {`,
         `${i3}port?.close();`,
         `${i2}}`,
         `${i1}});`,
         `${i1}ipcRenderer.on(\`\${channel}:close\`, (_event: unknown, key: unknown) => {`,
         `${i2}if (typeof key === 'string' && key === client.key) {`,
         `${i3}dropUtilityPort(client, 'The connection was closed');`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
      ].join("\n");
   }

   private buildUtilityClientListener(name: string): string {
      return `listenForUtilityPorts('${name}', ${this.wireName(name)});`;
   }

   private buildStreamListener(name: string): string {
      return `listenForStreamPorts(${this.wireName(name, ":port")});`;
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
   private getPortComponents(): string {
      const [i1, i2, i3, i4, i5, i6] = this.indents;
      const serialized = this.usesSerializer();
      // A `send` to a port throws synchronously, and a message of the queue does not.
      const wire = (args: string, encode = "encodeValue") =>
         serialized ? `[${encode}(channel, ${args})]` : args;
      return [
         "",
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
   private getPortInitializer(spec: t.ChannelSpec): string {
      const [i1] = this.indents;
      const portName = spec.name;
      return [
         `ports['${portName}'] = createPortChannel('${portName}', ${this.wireName(portName)}, ${this.getMaxQueue(spec)});`,
         `ipcRenderer.on(${this.wireName(portName)}, (event: IpcRendererEvent, key: unknown) => {`,
         `${i1}ports['${portName}'].pair(key, event.ports[0]);`,
         "});",
         `ipcRenderer.on(${this.wireName(portName, ":close")}, (_event: IpcRendererEvent, key: unknown) => {`,
         `${i1}ports['${portName}'].end(key);`,
         "});",
      ].join("\n");
   }
}
