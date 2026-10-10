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
import type { ChannelEntry, PreloadContext } from "./preload-bindings.js";
import { buildChannel } from "./preload-invoke.js";

/**
 * `ipc.<name>.stream(...args)` of a `stream` channel, which returns the stream: an async
 * iterator of the chunks, with `cancel()`. The page cannot pass an `AbortSignal`, which
 * `contextBridge` copies as an empty object, so cancelling is `cancel()`, `return()` or the
 * `break` of a `for await` loop.
 */
export function buildStreamChannel(ctx: PreloadContext, spec: t.ChannelSpec): ChannelEntry {
   const implementation = `(...args: any[]) => openStream('${spec.name}', ${ctx.wireName(spec.name)}, args, ${ctx.getHighWaterMark(spec)})`;
   return buildChannel(ctx.indents, spec.name, "stream", implementation);
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
export function buildStreamReader(indents: string[]): string {
   const [i1, i2, i3, i4] = indents;
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
export function buildStreamComponents(ctx: PreloadContext): string {
   const [i1, i2, i3, i4, i5] = ctx.indents;
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
      ...(ctx.usesSerializer
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
      `${i2}ipcRenderer.invoke(wire, id, ${ctx.usesSerializer ? "encodeValue(channel, args)" : "...args"}).then(`,
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

export function buildStreamListener(ctx: PreloadContext, name: string): string {
   return `listenForStreamPorts(${ctx.wireName(name, ":port")});`;
}

export function hasBrokeredStreams(specs: t.ChannelSpec[]): boolean {
   return specs.some((spec) => spec.kind === "Stream");
}
