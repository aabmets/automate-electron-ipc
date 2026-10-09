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

import { CLAMPED_TIMEOUT, errorClassLines, replyReaderLines } from "../generated-errors.js";

/**
 * The protocol between the main process and a utility process, which is the same in both
 * directions, so both files get this one text. A "peer" is one end of the connection: it is given
 * a function that posts a message to the other end, and is fed the messages that arrive from it.
 * The messages are plain objects, which structured clone can carry, and are tagged with `__ipc`,
 * so that other messages on the same port are left alone:
 * - `{ __ipc: 'send', channel, args }` is a one-way message, and goes to the listeners.
 * - `{ __ipc: 'call', channel, id, args }` is a request, which the handler of the channel answers
 *   with `{ __ipc: 'reply', channel, id, envelope }`. The envelope is the one of `invoke` channels.
 * - A call is rejected with an `IpcUtilityError`. It carries the `name`, `message`, `code` and
 *   `data` of what the handler threw, or one of the codes `IPC_UTILITY_EXITED`,
 *   `IPC_UTILITY_NO_HANDLER`, `IPC_UTILITY_UNSENDABLE`, `IPC_UTILITY_INVALID_REPLY` and
 *   `IPC_UTILITY_TIMEOUT`. The main process adds `IPC_UTILITY_NOT_ATTACHED` for a child that
 *   `forkUtility` or `attachUtility` never saw (see `buildUtilityHelpers` of the main bindings).
 * - A call with a `timeoutMs` above zero is rejected with `IPC_UTILITY_TIMEOUT` when no reply has
 *   arrived by then. The handler on the other side is not stopped, and its late reply is dropped.
 *
 * Everything that arrives is untrusted: a reply counts only if its ID is pending for the same
 * channel, and a message of an unknown shape is dropped. A peer is closed when the other end is
 * gone, which rejects the pending calls and the later ones.
 *
 * With a `serializer` (see `buildSerializerRuntime`, which the file must hold as well), `args` is a
 * list of one value, the list of the arguments as the serializer made it, and so is the value of
 * an `ok` envelope. The caller serializes the arguments and deserializes the value, and the other
 * side does the opposite. A call or a send that cannot be serialized fails with an
 * `IpcSerializationError`. A call that cannot be read is answered with the error envelope of that
 * error, so does a result that cannot be serialized, and the caller rejects with an
 * `IpcUtilityError` that has its name and code. A reply that cannot be read rejects the call with an
 * `IpcSerializationError`. A `send` that cannot be read is logged with `console.error` and dropped.
 */
export function buildUtilityPeer(indents: string[], serialized = false): string {
   const [i1, i2, i3, i4] = indents;
   return [
      "",
      ...errorClassLines(indents, "IpcUtilityError"),
      "",
      "interface UtilityPending {",
      `${i1}channel: string;`,
      `${i1}resolve: (value: unknown) => void;`,
      `${i1}reject: (error: IpcUtilityError) => void;`,
      "}",
      "",
      "type UtilityCallback = (...args: any[]) => unknown;",
      "",
      "interface UtilityPeer {",
      `${i1}post: (message: unknown) => void;`,
      `${i1}closed: boolean;`,
      `${i1}pending: Map<number, UtilityPending>;`,
      `${i1}handlers: Map<string, UtilityCallback>;`,
      `${i1}listeners: Map<string, Set<UtilityCallback>>;`,
      "}",
      "",
      "let lastUtilityCallId = 0;",
      "",
      "function createUtilityPeer(post: (message: unknown) => void): UtilityPeer {",
      `${i1}return { post, closed: false, pending: new Map(), handlers: new Map(), listeners: new Map() };`,
      "}",
      "",
      "function closeUtilityPeer(peer: UtilityPeer, reason: string): void {",
      `${i1}if (peer.closed) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}peer.closed = true;`,
      `${i1}const pending = [...peer.pending.values()];`,
      `${i1}peer.pending.clear();`,
      `${i1}for (const call of pending) {`,
      `${i2}call.reject(new IpcUtilityError(call.channel, \`\${reason} before the channel '\${call.channel}' was answered\`, 'IPC_UTILITY_EXITED'));`,
      `${i1}}`,
      "}",
      "",
      "function unsendableUtilityError(channel: string, error: unknown): IpcUtilityError {",
      `${i1}return new IpcUtilityError(channel, \`A message of the channel '\${channel}' cannot be sent: \${toIpcError(error).message}\`, 'IPC_UTILITY_UNSENDABLE');`,
      "}",
      "",
      ...replyReaderLines(indents, {
         fn: "readUtilityReply",
         errorClass: "IpcUtilityError",
         invalidCode: "IPC_UTILITY_INVALID_REPLY",
         invalidMessage: "'The other side sent an unreadable reply'",
         missingMessage: "'The other side failed without a message'",
      }),
      "",
      "function sendUtilityReply(peer: UtilityPeer, channel: string, id: number, envelope: IpcEnvelope): void {",
      `${i1}if (peer.closed) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}try {`,
      `${i2}peer.post({ __ipc: 'reply', channel, id, envelope });`,
      `${i1}} catch (error) {`,
      `${i2}// A value that cannot be cloned must not leave the caller waiting.`,
      `${i2}try {`,
      `${i3}const failure = unsendableUtilityError(channel, error);`,
      `${i3}peer.post({ __ipc: 'reply', channel, id, envelope: { ok: false, error: { name: failure.name, message: failure.message, code: failure.code } } });`,
      `${i2}} catch (cause) {`,
      `${i3}console.error(cause);`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
      "function receiveUtilityMessage(peer: UtilityPeer, message: unknown): void {",
      `${i1}const source = typeof message === 'object' && message !== null ? (message as { [key: string]: unknown }) : null;`,
      `${i1}if (!source || typeof source.__ipc !== 'string' || typeof source.channel !== 'string') {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}const channel = source.channel;`,
      `${i1}if (source.__ipc === 'reply') {`,
      `${i2}const id = source.id;`,
      `${i2}const call = typeof id === 'number' ? peer.pending.get(id) : undefined;`,
      `${i2}if (typeof id === 'number' && call && call.channel === channel) {`,
      `${i3}peer.pending.delete(id);`,
      `${i3}const outcome = readUtilityReply(channel, source.envelope);`,
      `${i3}if ('error' in outcome) {`,
      `${i4}call.reject(outcome.error);`,
      ...(serialized
         ? [
              `${i3}} else {`,
              `${i4}try {`,
              `${i4}${i1}call.resolve(decodeValue(channel, outcome.value));`,
              `${i4}} catch (error) {`,
              `${i4}${i1}call.reject(error as IpcUtilityError);`,
              `${i4}}`,
              `${i3}}`,
           ]
         : [`${i3}} else {`, `${i4}call.resolve(outcome.value);`, `${i3}}`]),
      `${i2}}`,
      `${i1}} else if (source.__ipc === 'send' && Array.isArray(source.args)) {`,
      ...(serialized
         ? [
              `${i2}const args = readSentArguments(channel, source.args);`,
              `${i2}if (!args) {`,
              `${i3}return;`,
              `${i2}}`,
           ]
         : [`${i2}const args: unknown[] = source.args;`]),
      `${i2}for (const listener of [...(peer.listeners.get(channel) ?? [])]) {`,
      `${i3}try {`,
      `${i4}const result = listener(...args) as { then?: unknown } | undefined;`,
      `${i4}if (result && typeof result.then === 'function') {`,
      `${i4}${i1}(result as Promise<unknown>).then(undefined, (error: unknown) => console.error(error));`,
      `${i4}}`,
      `${i3}} catch (error) {`,
      `${i4}console.error(error);`,
      `${i3}}`,
      `${i2}}`,
      `${i1}} else if (source.__ipc === 'call' && typeof source.id === 'number' && Array.isArray(source.args)) {`,
      `${i2}const id: number = source.id;`,
      `${i2}const args: unknown[] = source.args;`,
      `${i2}const handler = peer.handlers.get(channel);`,
      `${i2}void settleInvoke(${serialized ? "async " : ""}() => {`,
      `${i3}if (!handler) {`,
      `${i4}throw { name: 'IpcUtilityError', message: \`The other side has no handler for the channel '\${channel}'\`, code: 'IPC_UTILITY_NO_HANDLER' };`,
      `${i3}}`,
      ...(serialized
         ? [`${i3}return encodeValue(channel, await handler(...readArguments(channel, args)));`]
         : [`${i3}return handler(...args);`]),
      `${i2}}).then((envelope) => sendUtilityReply(peer, channel, id, envelope));`,
      `${i1}}`,
      "}",
      "",
      "function callUtilityPeer(peer: UtilityPeer, channel: string, args: unknown[], timeoutMs = 0): Promise<unknown> {",
      `${i1}return new Promise<unknown>((resolve, reject) => {`,
      `${i2}if (peer.closed) {`,
      `${i3}reject(new IpcUtilityError(channel, \`The other side of the channel '\${channel}' is gone\`, 'IPC_UTILITY_EXITED'));`,
      `${i3}return;`,
      `${i2}}`,
      ...(serialized
         ? [
              `${i2}let wired: unknown[];`,
              `${i2}try {`,
              `${i3}wired = [encodeValue(channel, args)];`,
              `${i2}} catch (error) {`,
              `${i3}reject(error);`,
              `${i3}return;`,
              `${i2}}`,
           ]
         : []),
      `${i2}const id = ++lastUtilityCallId;`,
      `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
      `${i2}peer.pending.set(id, {`,
      `${i3}channel,`,
      `${i3}resolve: (value) => {`,
      `${i4}clearTimeout(timer);`,
      `${i4}resolve(value);`,
      `${i3}},`,
      `${i3}reject: (error) => {`,
      `${i4}clearTimeout(timer);`,
      `${i4}reject(error);`,
      `${i3}},`,
      `${i2}});`,
      `${i2}try {`,
      `${i3}peer.post({ __ipc: 'call', channel, id, ${serialized ? "args: wired" : "args"} });`,
      `${i2}} catch (error) {`,
      `${i3}peer.pending.delete(id);`,
      `${i3}reject(unsendableUtilityError(channel, error));`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}if (timeoutMs > 0) {`,
      `${i3}timer = setTimeout(() => {`,
      `${i4}// The handler goes on, and its late reply finds no pending call and is dropped.`,
      `${i4}peer.pending.delete(id);`,
      `${i4}reject(new IpcUtilityError(channel, \`The channel '\${channel}' did not answer within \${timeoutMs} ms\`, 'IPC_UTILITY_TIMEOUT'));`,
      `${i3}}, ${CLAMPED_TIMEOUT});`,
      `${i2}}`,
      `${i1}});`,
      "}",
      "",
      "function sendUtilityPeer(peer: UtilityPeer, channel: string, args: unknown[]): void {",
      `${i1}if (peer.closed) {`,
      `${i2}throw new IpcUtilityError(channel, \`The other side of the channel '\${channel}' is gone\`, 'IPC_UTILITY_EXITED');`,
      `${i1}}`,
      ...(serialized ? [`${i1}const wired = [encodeValue(channel, args)];`] : []),
      `${i1}try {`,
      `${i2}peer.post({ __ipc: 'send', channel, ${serialized ? "args: wired" : "args"} });`,
      `${i1}} catch (error) {`,
      `${i2}throw unsendableUtilityError(channel, error);`,
      `${i1}}`,
      "}",
      "",
      "function setUtilityHandler(peer: UtilityPeer, channel: string, callback: UtilityCallback): () => void {",
      `${i1}peer.handlers.set(channel, callback);`,
      `${i1}return () => {`,
      `${i2}if (peer.handlers.get(channel) === callback) {`,
      `${i3}peer.handlers.delete(channel);`,
      `${i2}}`,
      `${i1}};`,
      "}",
      "",
      "function addUtilityListener(peer: UtilityPeer, channel: string, callback: UtilityCallback, once: boolean): () => void {",
      `${i1}let listeners = peer.listeners.get(channel);`,
      `${i1}if (!listeners) {`,
      `${i2}listeners = new Set();`,
      `${i2}peer.listeners.set(channel, listeners);`,
      `${i1}}`,
      `${i1}const set = listeners;`,
      `${i1}// Every registration gets a listener of its own, so that the same callback can be added twice.`,
      `${i1}const listener: UtilityCallback = (...args) => {`,
      `${i2}if (once) {`,
      `${i3}remove();`,
      `${i2}}`,
      `${i2}return callback(...args);`,
      `${i1}};`,
      `${i1}const remove = () => {`,
      `${i2}set.delete(listener);`,
      `${i1}};`,
      `${i1}set.add(listener);`,
      `${i1}return remove;`,
      "}",
      "",
   ].join("\n");
}
