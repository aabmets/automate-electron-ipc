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
import type { ChannelEntry, PreloadContext } from "./preload-bindings.js";
import { buildChannel } from "./preload-invoke.js";
import { hasBrokeredStreams } from "./preload-streams.js";
import { buildUtilityCalls } from "./preload-utility-calls.js";

/** The client of the channels to a utility process, and the listeners for the ports of the channels. */
export function buildUtilityClient(ctx: PreloadContext, specs: t.ChannelSpec[]): string[] {
   return [
      buildUtilityClientComponents(ctx, hasBrokeredStreams(specs)),
      ...specs
         .sort((a, b) => utils.compareStrings(a.name, b.name))
         .map((spec) => buildUtilityClientListener(ctx, spec.name)),
      "",
   ];
}

/**
 * `ipc.<name>.invoke(...args)` of an `invokeUtility` channel and `ipc.<name>.stream(...args)` of
 * a `streamUtility` channel, which talk to the utility process over the port that the main
 * process brokers (see `buildUtilityClientComponents`).
 */
export function buildBrokeredChannel(ctx: PreloadContext, spec: t.ChannelSpec): ChannelEntry {
   const client = `utilityClients['${spec.name}']`;
   if (spec.kind === "Stream") {
      return buildChannel(
         ctx.indents,
         spec.name,
         "stream",
         `(...args: any[]) => openUtilityStream(${client}, args, ${ctx.getHighWaterMark(spec)}${ctx.getTimeoutArgument(spec)})`,
      );
   }
   return buildChannel(
      ctx.indents,
      spec.name,
      "invoke",
      `(...args: any[]) => callUtilityPort(${client}, args${ctx.getTimeoutArgument(spec)})`,
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
function buildUtilityClientComponents(ctx: PreloadContext, streams: boolean): string {
   return [
      ...buildUtilityConnection(ctx),
      ...buildUtilityCalls(ctx, streams),
      ...buildUtilityPortListener(ctx.indents),
   ].join("\n");
}

/** The state of a connection: dropping its port, receiving from the port, and attaching a new one. */
function buildUtilityConnection(ctx: PreloadContext): string[] {
   const [i1, i2, i3, i4] = ctx.indents;
   const serialized = ctx.usesSerializer;
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
   ];
}

/** `listenForUtilityPorts`, which the client of a channel starts with. */
function buildUtilityPortListener(indents: string[]): string[] {
   const [i1, i2, i3] = indents;
   return [
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
   ];
}

function buildUtilityClientListener(ctx: PreloadContext, name: string): string {
   return `listenForUtilityPorts('${name}', ${ctx.wireName(name)});`;
}
