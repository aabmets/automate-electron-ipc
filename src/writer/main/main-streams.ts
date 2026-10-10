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

/**
 * `startStream`, which the listener of a `stream` channel calls with the iterable that the
 * handler returned. It makes a `MessageChannelMain` for the call, hands one port to the frame
 * that asked, with the ID that the page chose, and drives the iterator over the other one. The
 * messages are `{ type: 'chunk', value }` in order, then `{ type: 'end' }` or
 * `{ type: 'error', error }`, and then the port is closed. The page cancels with
 * `{ type: 'cancel' }` or by closing its port, and the stream also stops when the contents are
 * destroyed. A stop calls `return()` on the iterator once, so that the generator runs its
 * `finally` blocks, and no chunk is sent after it. A chunk that cannot be cloned stops the
 * iterator and fails the stream. Everything that goes wrong before the port is handed over is
 * thrown, and reaches the page as the envelope of the call, so no port exists for it.
 *
 * The flow is controlled by credits. The page may have at most `highWaterMark` chunks that it
 * has not read, so the main process starts with a `limit` of that many chunks. It counts the
 * chunks that it sent, and does not pull from the generator once `sent` reaches `limit`.
 * The page raises the limit with `{ type: 'credit', limit }`, the total number of chunks that it
 * allows so far, as it reads. An absolute total is safe against a repeated or late message, and
 * only a higher one counts. A stop wakes the pump that waits for credit, so a cancel, a closed
 * port and a destroyed contents work while the generator is paused. With `Infinity` the
 * generator is never paused. The `destroyed` event of the contents is watched through
 * `watchEvent`, so any number of open streams of a page adds one listener, and not one each.
 */
export function buildStreamHelpers(ctx: MainContext): string {
   const [i1, i2, i3, i4, i5] = ctx.indents;
   return [
      "",
      "function stopIterator(iterator: AsyncIterator<unknown>): void {",
      `${i1}try {`,
      `${i2}Promise.resolve(iterator.return?.()).catch((error: unknown) => console.error(error));`,
      `${i1}} catch (error) {`,
      `${i2}console.error(error);`,
      `${i1}}`,
      "}",
      "",
      "async function startStream(",
      `${i1}event: IpcMainInvokeEvent,`,
      `${i1}channel: string,`,
      `${i1}wire: string,`,
      `${i1}id: unknown,`,
      `${i1}highWaterMark: number,`,
      `${i1}produce: () => unknown,`,
      "): Promise<void> {",
      `${i1}if (typeof id !== 'number') {`,
      `${i2}throw { name: 'IpcStreamError', message: \`The call of the channel '\${channel}' has no stream ID\`, code: 'IPC_STREAM_INVALID_REQUEST' };`,
      `${i1}}`,
      `${i1}const source = (await produce()) as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> } | null | undefined;`,
      `${i1}const open = source ? source[Symbol.asyncIterator] : undefined;`,
      `${i1}if (!source || typeof open !== 'function') {`,
      `${i2}throw { name: 'IpcStreamError', message: \`The handler of the channel '\${channel}' did not return an async iterable\`, code: 'IPC_STREAM_NOT_ITERABLE' };`,
      `${i1}}`,
      `${i1}const iterator = open.call(source);`,
      `${i1}const { port1, port2 } = new MessageChannelMain();`,
      `${i1}// The port goes to the frame that asked. A frame that is gone cannot be reached.`,
      `${i1}let target: WebContents | WebFrameMain = event.sender;`,
      `${i1}try {`,
      `${i2}const frame = event.senderFrame;`,
      `${i2}if (frame && !frame.isDestroyed?.() && !frame.detached) {`,
      `${i3}target = frame;`,
      `${i2}}`,
      `${i1}} catch {`,
      `${i2}// The sender is used instead.`,
      `${i1}}`,
      `${i1}try {`,
      `${i2}target.postMessage(\`\${wire}:port\`, id, [port2]);`,
      `${i1}} catch (error) {`,
      `${i2}port1.close();`,
      `${i2}stopIterator(iterator);`,
      `${i2}throw error;`,
      `${i1}}`,
      `${i1}const sender = event.sender;`,
      `${i1}let done = false;`,
      `${i1}let limit = highWaterMark;`,
      `${i1}let sent = 0;`,
      `${i1}let unwatch = (): void => undefined;`,
      `${i1}let wake: (() => void) | null = null;`,
      `${i1}const resume = (): void => {`,
      `${i2}const waiting = wake;`,
      `${i2}wake = null;`,
      `${i2}waiting?.();`,
      `${i1}};`,
      `${i1}const finish = (): boolean => {`,
      `${i2}if (done) {`,
      `${i3}return false;`,
      `${i2}}`,
      `${i2}done = true;`,
      `${i2}resume();`,
      `${i2}unwatch();`,
      `${i2}port1.close();`,
      `${i2}return true;`,
      `${i1}};`,
      `${i1}const cancel = (): void => {`,
      `${i2}if (finish()) {`,
      `${i3}stopIterator(iterator);`,
      `${i2}}`,
      `${i1}};`,
      `${i1}const fail = (error: IpcErrorInfo): void => {`,
      `${i2}if (!done) {`,
      `${i3}try {`,
      `${i4}port1.postMessage({ type: 'error', error });`,
      `${i3}} catch (cause) {`,
      `${i4}console.error(cause);`,
      `${i3}}`,
      `${i3}finish();`,
      `${i2}}`,
      `${i1}};`,
      `${i1}port1.on('message', (message: { data: unknown }) => {`,
      `${i2}const data = message.data as { type?: unknown; limit?: unknown } | null;`,
      `${i2}if (data && data.type === 'cancel') {`,
      `${i3}cancel();`,
      `${i2}} else if (data && data.type === 'credit' && typeof data.limit === 'number' && data.limit > limit) {`,
      `${i3}limit = data.limit;`,
      `${i3}resume();`,
      `${i2}}`,
      `${i1}});`,
      `${i1}port1.on('close', cancel);`,
      `${i1}unwatch = watchEvent(sender, 'destroyed', cancel);`,
      `${i1}port1.start();`,
      `${i1}const pump = async (): Promise<void> => {`,
      `${i2}while (!done) {`,
      `${i3}if (sent >= limit) {`,
      `${i4}// The page has not read enough chunks: the generator waits for credit, a cancel or a stop.`,
      `${i4}await new Promise<void>((resolve) => {`,
      `${i5}wake = resolve;`,
      `${i4}});`,
      `${i4}continue;`,
      `${i3}}`,
      `${i3}let step: IteratorResult<unknown>;`,
      `${i3}try {`,
      `${i4}step = await iterator.next();`,
      `${i3}} catch (error) {`,
      `${i4}fail(toIpcError(error));`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}if (done) {`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}if (step.done) {`,
      `${i4}try {`,
      `${i5}port1.postMessage({ type: 'end' });`,
      `${i4}} catch (cause) {`,
      `${i5}console.error(cause);`,
      `${i4}}`,
      `${i4}finish();`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}try {`,
      `${i4}port1.postMessage({ type: 'chunk', value: ${ctx.usesSerializer ? "encodeValue(channel, step.value)" : "step.value"} });`,
      `${i4}sent += 1;`,
      `${i3}} catch (error) {`,
      `${i4}stopIterator(iterator);`,
      `${i4}fail({ name: 'IpcStreamError', message: \`A chunk of the channel '\${channel}' cannot be sent: \${toIpcError(error).message}\`, code: 'IPC_STREAM_UNSENDABLE' });`,
      `${i4}return;`,
      `${i3}}`,
      `${i2}}`,
      `${i1}};`,
      `${i1}void pump();`,
      "}",
      "",
   ].join("\n");
}
