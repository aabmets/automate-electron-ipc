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
import { buildErrorEnvelope, buildUtilityPeer, UTILITY_RUNTIME_NAMES } from "./utility-runtime.js";

interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
}

/**
 * Writes `utility.ts`, the bindings for the code that runs in a utility process (`utilityProcess.fork`).
 * It talks to the main process over `process.parentPort`, and needs no import from `electron`.
 * It is written only when the schema has a channel between the main process and a utility process.
 */
export class UtilityBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.utilityBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      return [
         ...UTILITY_RUNTIME_NAMES,
         "ipc",
         "UtilityParentPort",
         "utilityPeer",
         "getUtilityPeer",
         "globalThis",
         // The code which serves the ports that the main process brokers for pages.
         ...(this.hasBrokeredChannels()
            ? [
                 "BrokerPort",
                 "BrokerStream",
                 "brokerCalls",
                 "brokerStreams",
                 "brokerWindows",
                 "brokerChannels",
                 "setBrokerCall",
                 "setBrokerStream",
                 "stopBrokerIterator",
                 "runBrokeredStream",
                 "serveBrokeredPort",
                 "acceptBrokeredPort",
                 "Symbol",
                 "AsyncIterator",
                 "IteratorResult",
              ]
            : []),
      ];
   }
   /** Whether any schema file declares a channel between a renderer and a utility process. */
   private hasBrokeredChannels(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some((spec) => this.isBrokeredSpec(spec)),
      );
   }
   /** Whether the schema has anything for this file, which is not written otherwise. */
   public hasChannels(): boolean {
      return this.hasUtilityChannels();
   }
   protected renderEmptyFileContents(): string {
      return "export const ipc = {};";
   }
   protected renderFileContents(): string {
      const channels: ChannelEntry[] = [];
      const importDeclarations: string[] = [];
      for (const parsedFileSpecs of this.pfsArray) {
         const customTypes = new Set<string>();
         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (!(this.isUtilitySpec(spec) || this.isBrokeredSpec(spec))) {
               continue;
            }
            channels.push(this.buildChannel(spec));
            for (const customType of spec.signature.customTypes) {
               customTypes.add(customType);
            }
         }
         for (const customType of customTypes) {
            const declaration = this.importsGenerator.getDeclaration(parsedFileSpecs, customType);
            if (declaration) {
               importDeclarations.push(declaration);
            }
         }
      }
      const out = importDeclarations.sort(utils.compareStrings);
      const brokered = this.getBrokeredSpecs();
      out.push(
         buildErrorEnvelope(this.indents),
         buildUtilityPeer(this.indents),
         this.buildParentPort(brokered.length > 0),
         ...(brokered.length > 0 ? [this.buildBrokerServer(brokered)] : []),
         this.buildBindings(channels),
      );
      return out.join("\n");
   }
   /**
    * The peer of the main process, which is made when a channel is first used. The port is read
    * from `process.parentPort`, which exists only in a utility process, so the file can be
    * imported anywhere and fails with a clear error when a channel is used elsewhere. Electron
    * queues the messages of the main process until a listener is added, so none is lost in between.
    */
   private buildParentPort(brokers: boolean): string {
      const [i1, i2, i3] = this.indents;
      const event = brokers ? "{ data: unknown; ports?: BrokerPort[] }" : "{ data: unknown }";
      const receive = brokers
         ? [
              `${i1}port.on('message', (event) => {`,
              `${i2}if (!acceptBrokeredPort(event)) {`,
              `${i3}receiveUtilityMessage(peer, event.data);`,
              `${i2}}`,
              `${i1}});`,
           ]
         : [`${i1}port.on('message', (event) => receiveUtilityMessage(peer, event.data));`];
      return [
         "interface UtilityParentPort {",
         `${i1}on: (event: 'message', listener: (event: ${event}) => void) => unknown;`,
         `${i1}postMessage: (message: unknown) => void;`,
         "}",
         "",
         "let utilityPeer: UtilityPeer | undefined;",
         "",
         "function getUtilityPeer(): UtilityPeer {",
         `${i1}if (utilityPeer) {`,
         `${i1}${i1}return utilityPeer;`,
         `${i1}}`,
         `${i1}const port = (globalThis as unknown as { process?: { parentPort?: UtilityParentPort } }).process?.parentPort;`,
         `${i1}if (!port) {`,
         `${i1}${i1}throw new TypeError('These bindings can be used only in an Electron utility process, which has process.parentPort');`,
         `${i1}}`,
         `${i1}const peer = createUtilityPeer((message) => port.postMessage(message));`,
         ...receive,
         `${i1}utilityPeer = peer;`,
         `${i1}return peer;`,
         "}",
         "",
      ].join("\n");
   }
   /** The wire names of the channels between a page and the child, and their kinds. */
   private getBrokeredSpecs(): t.ChannelSpec[] {
      return this.pfsArray.flatMap((pfs) =>
         pfs.specs.channelSpecArray.filter((spec) => this.isBrokeredSpec(spec)),
      );
   }
   /**
    * The ports that the main process brokers between a page and this process, one per
    * `ipc.<name>.connect` of `invokeUtility` and `streamUtility` channels. A port arrives as
    * `{ __ipc: 'port', channel, key }` on `process.parentPort`, with the port in `event.ports`.
    * Only the channels of this file are accepted, and any other port is closed. A port serves
    * the one channel it was made for, and ignores messages of other channels.
    *
    * The messages of the page are handled like those of the main process: a `call` is answered by
    * the shared peer code, with the single handler of the channel. A `stream` message starts the
    * handler, which returns an async iterable, and the iterator is pumped to the page as `chunk`
    * messages and then `end`, or `error`. All the streams of a port share it, told apart by the ID
    * of the call. A `cancel` message, and the close of the port, stop the iterator once with
    * `return()`, so the generator runs its `finally` blocks, and no chunk is sent after it. Everything
    * that goes wrong before the first chunk is sent as the `error` message of the call. A chunk that
    * cannot be cloned stops the iterator and fails the stream.
    *
    * The flow is controlled by credits, per call, as in `startStream` of `main.ts`. A call starts
    * with a `limit` of the `highWaterMark` of its channel, and the pump does not pull from the
    * generator once it has sent that many chunks. The page raises the limit with `{ __ipc: 'credit',
    * channel, id, limit }`, the total number of chunks that it allows so far, as it reads. A
    * cancel, a closed port and an error wake a paused pump, so they work while the generator is
    * paused.
    */
   private buildBrokerServer(brokered: t.ChannelSpec[]): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      const channels = brokered
         .map((spec) => this.wireName(spec.name))
         .sort(utils.compareStrings)
         .join(", ");
      const windows = brokered
         .filter((spec) => spec.kind === "Stream")
         .map((spec) => [this.wireName(spec.name), this.getHighWaterMark(spec)] as const)
         .sort(([a], [b]) => utils.compareStrings(a, b))
         .map(([wire, mark]) => `[${wire}, ${mark}]`)
         .join(", ");
      return [
         "interface BrokerPort {",
         `${i1}on: (event: 'message' | 'close', listener: (event: { data: unknown }) => void) => unknown;`,
         `${i1}start: () => void;`,
         `${i1}postMessage: (message: unknown) => void;`,
         `${i1}close: () => void;`,
         "}",
         "",
         "interface BrokerStream {",
         `${i1}iterator?: AsyncIterator<unknown>;`,
         `${i1}cancelled: boolean;`,
         `${i1}limit: number;`,
         `${i1}wake?: () => void;`,
         "}",
         "",
         `const brokerChannels = new Set<string>([${channels}]);`,
         `const brokerWindows = new Map<string, number>([${windows}]);`,
         "const brokerCalls = new Map<string, UtilityCallback>();",
         "const brokerStreams = new Map<string, UtilityCallback>();",
         "",
         "function setBrokerCall(channel: string, callback: UtilityCallback): () => void {",
         `${i1}getUtilityPeer();`,
         `${i1}brokerCalls.set(channel, callback);`,
         `${i1}return () => {`,
         `${i2}if (brokerCalls.get(channel) === callback) {`,
         `${i3}brokerCalls.delete(channel);`,
         `${i2}}`,
         `${i1}};`,
         "}",
         "",
         "function setBrokerStream(channel: string, callback: UtilityCallback): () => void {",
         `${i1}getUtilityPeer();`,
         `${i1}brokerStreams.set(channel, callback);`,
         `${i1}return () => {`,
         `${i2}if (brokerStreams.get(channel) === callback) {`,
         `${i3}brokerStreams.delete(channel);`,
         `${i2}}`,
         `${i1}};`,
         "}",
         "",
         "function stopBrokerIterator(iterator: AsyncIterator<unknown>): void {",
         `${i1}try {`,
         `${i2}Promise.resolve(iterator.return?.()).catch((error: unknown) => console.error(error));`,
         `${i1}} catch (error) {`,
         `${i2}console.error(error);`,
         `${i1}}`,
         "}",
         "",
         "async function runBrokeredStream(",
         `${i1}channel: string,`,
         `${i1}peer: UtilityPeer,`,
         `${i1}streams: Map<number, BrokerStream>,`,
         `${i1}id: number,`,
         `${i1}args: unknown[],`,
         "): Promise<void> {",
         `${i1}const entry: BrokerStream = { cancelled: false, limit: brokerWindows.get(channel) ?? 0 };`,
         `${i1}streams.set(id, entry);`,
         `${i1}const fail = (error: unknown): void => {`,
         `${i2}entry.cancelled = true;`,
         `${i2}streams.delete(id);`,
         `${i2}try {`,
         `${i3}peer.post({ __ipc: 'error', channel, id, error: toIpcError(error) });`,
         `${i2}} catch (cause) {`,
         `${i3}console.error(cause);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}let iterator: AsyncIterator<unknown>;`,
         `${i1}try {`,
         `${i2}const handler = brokerStreams.get(channel);`,
         `${i2}if (!handler) {`,
         `${i3}throw { name: 'IpcUtilityError', message: \`The utility process has no stream handler for the channel '\${channel}'\`, code: 'IPC_UTILITY_NO_HANDLER' };`,
         `${i2}}`,
         `${i2}const source = (await handler(...args)) as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> } | null | undefined;`,
         `${i2}const open = source ? source[Symbol.asyncIterator] : undefined;`,
         `${i2}if (!source || typeof open !== 'function') {`,
         `${i3}throw { name: 'IpcUtilityError', message: \`The handler of the channel '\${channel}' did not return an async iterable\`, code: 'IPC_UTILITY_NOT_ITERABLE' };`,
         `${i2}}`,
         `${i2}iterator = open.call(source);`,
         `${i1}} catch (error) {`,
         `${i2}if (!entry.cancelled) {`,
         `${i3}fail(error);`,
         `${i2}}`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}// A cancel that arrived while the handler was starting.`,
         `${i1}if (entry.cancelled) {`,
         `${i2}stopBrokerIterator(iterator);`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}entry.iterator = iterator;`,
         `${i1}let sent = 0;`,
         `${i1}while (!entry.cancelled) {`,
         `${i2}if (sent >= entry.limit) {`,
         `${i3}// The page has not read enough chunks: the generator waits for credit or a cancel.`,
         `${i3}await new Promise<void>((resolve) => {`,
         `${i4}entry.wake = resolve;`,
         `${i3}});`,
         `${i3}continue;`,
         `${i2}}`,
         `${i2}let step: IteratorResult<unknown>;`,
         `${i2}try {`,
         `${i3}step = await iterator.next();`,
         `${i2}} catch (error) {`,
         `${i3}if (!entry.cancelled) {`,
         `${i4}fail(error);`,
         `${i3}}`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (entry.cancelled) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (step.done) {`,
         `${i3}entry.cancelled = true;`,
         `${i3}streams.delete(id);`,
         `${i3}try {`,
         `${i4}peer.post({ __ipc: 'end', channel, id });`,
         `${i3}} catch (cause) {`,
         `${i4}console.error(cause);`,
         `${i3}}`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}try {`,
         `${i3}peer.post({ __ipc: 'chunk', channel, id, value: step.value });`,
         `${i3}sent += 1;`,
         `${i2}} catch (error) {`,
         `${i3}stopBrokerIterator(iterator);`,
         `${i3}fail({ name: 'IpcUtilityError', message: \`A chunk of the channel '\${channel}' cannot be sent: \${toIpcError(error).message}\`, code: 'IPC_UTILITY_UNSENDABLE' });`,
         `${i3}return;`,
         `${i2}}`,
         `${i1}}`,
         "}",
         "",
         "function serveBrokeredPort(channel: string, port: BrokerPort): void {",
         `${i1}const peer = createUtilityPeer((message) => port.postMessage(message));`,
         `${i1}peer.handlers = brokerCalls;`,
         `${i1}const streams = new Map<number, BrokerStream>();`,
         `${i1}port.on('message', (event) => {`,
         `${i2}const source = typeof event.data === 'object' && event.data !== null ? (event.data as { [key: string]: unknown }) : null;`,
         `${i2}if (!source || source.channel !== channel) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (source.__ipc === 'stream' && typeof source.id === 'number' && Array.isArray(source.args)) {`,
         `${i3}if (!streams.has(source.id)) {`,
         `${i4}void runBrokeredStream(channel, peer, streams, source.id, source.args);`,
         `${i3}}`,
         `${i2}} else if (source.__ipc === 'credit' && typeof source.id === 'number') {`,
         `${i3}const entry = streams.get(source.id);`,
         `${i3}if (entry && typeof source.limit === 'number' && source.limit > entry.limit) {`,
         `${i4}entry.limit = source.limit;`,
         `${i4}entry.wake?.();`,
         `${i3}}`,
         `${i2}} else if (source.__ipc === 'cancel' && typeof source.id === 'number') {`,
         `${i3}const entry = streams.get(source.id);`,
         `${i3}if (entry) {`,
         `${i4}entry.cancelled = true;`,
         `${i4}streams.delete(source.id);`,
         `${i4}entry.wake?.();`,
         `${i4}if (entry.iterator) {`,
         `${i5}stopBrokerIterator(entry.iterator);`,
         `${i4}}`,
         `${i3}}`,
         `${i2}} else {`,
         `${i3}receiveUtilityMessage(peer, source);`,
         `${i2}}`,
         `${i1}});`,
         `${i1}port.on('close', () => {`,
         `${i2}closeUtilityPeer(peer, 'The page closed the connection');`,
         `${i2}for (const entry of [...streams.values()]) {`,
         `${i3}entry.cancelled = true;`,
         `${i3}entry.wake?.();`,
         `${i3}if (entry.iterator) {`,
         `${i4}stopBrokerIterator(entry.iterator);`,
         `${i3}}`,
         `${i2}}`,
         `${i2}streams.clear();`,
         `${i1}});`,
         `${i1}port.start();`,
         "}",
         "",
         "function acceptBrokeredPort(event: { data: unknown; ports?: BrokerPort[] }): boolean {",
         `${i1}const source = typeof event.data === 'object' && event.data !== null ? (event.data as { [key: string]: unknown }) : null;`,
         `${i1}if (!source || source.__ipc !== 'port') {`,
         `${i2}return false;`,
         `${i1}}`,
         `${i1}const port = event.ports?.[0];`,
         `${i1}if (port && typeof source.channel === 'string' && brokerChannels.has(source.channel)) {`,
         `${i2}serveBrokeredPort(source.channel, port);`,
         `${i1}} else {`,
         `${i2}port?.close();`,
         `${i1}}`,
         `${i1}return true;`,
         "}",
         "",
      ].join("\n");
   }
   private buildBindings(channels: ChannelEntry[]): string {
      const [i0] = this.indents;
      const out = ["export const ipc = {"];
      for (const channel of this.sortChannels(channels)) {
         out.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      out.push("\n}\n");
      return out.join("");
   }
   /**
    * `handle(callback)` of a `callUtility` channel, `on(callback)` and `once(callback)` of a
    * `notifyUtility` channel, `invoke(...args)` of a `callMain` channel and `send(...args)` of a
    * `notifyMain` channel. A handler replaces the previous one, and the function that `handle`
    * returns removes only its own. The `handle(callback)` of an `invokeUtility` or `streamUtility`
    * channel serves the page over the port that the main process brokers.
    */
   private buildChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const callbackName = this.uniqueName("callback", taken);
      const wire = this.wireName(spec.name);
      const typeParams = this.getTypeParams(spec.signature);
      const params = this.getOriginalParams(spec, false);
      const senderParams = this.getOriginalParams(spec, true);
      const rest = senderParams ? `[${senderParams}]` : "[]";
      const callback = `${callbackName}: ${spec.signature.definition}`;
      if (spec.direction === "RendererToUtility") {
         // A page calls the handler, or reads the stream of the handler, over a brokered port.
         const register = spec.kind === "Stream" ? "setBrokerStream" : "setBrokerCall";
         return {
            name: spec.name,
            members: [
               `\n${i1}handle: (${callback}) =>`,
               `\n${i2}${register}(${wire}, ${callbackName}),`,
            ],
         };
      }
      if (spec.direction === "UtilityToMain") {
         if (spec.kind === "Broadcast") {
            return {
               name: spec.name,
               members: [
                  `\n${i1}send: ${typeParams}(${params}): void =>`,
                  `\n${i2}sendUtilityPeer(getUtilityPeer(), ${wire}, ${rest}),`,
               ],
            };
         }
         const returned = spec.signature.async
            ? spec.signature.returnType
            : `Promise<Awaited<${spec.signature.returnType}>>`;
         return {
            name: spec.name,
            members: [
               `\n${i1}invoke: ${typeParams}(${params}): ${returned} =>`,
               `\n${i2}callUtilityPeer(getUtilityPeer(), ${wire}, ${rest}${this.getTimeoutArgument(spec)}) as ${returned},`,
            ],
         };
      }
      if (spec.kind === "Broadcast") {
         return {
            name: spec.name,
            members: [
               `\n${i1}on: (${callback}) =>`,
               `\n${i2}addUtilityListener(getUtilityPeer(), ${wire}, ${callbackName}, false),`,
               `\n${i1}once: (${callback}) =>`,
               `\n${i2}addUtilityListener(getUtilityPeer(), ${wire}, ${callbackName}, true),`,
            ],
         };
      }
      return {
         name: spec.name,
         members: [
            `\n${i1}handle: (${callback}) =>`,
            `\n${i2}setUtilityHandler(getUtilityPeer(), ${wire}, ${callbackName}),`,
         ],
      };
   }
}
