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

/**
 * `ipc.<name>.handle(callback)` of an `ask` channel, the single responder to the questions of
 * the main process. A new responder replaces the previous one, and the function that `handle`
 * returns removes only its own, so that the disposer of a replaced responder does nothing.
 */
export function buildAskChannel(indents: string[], spec: t.ChannelSpec): ChannelEntry {
   const [i0, i1, i2, i3, i4] = indents;
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
export function buildErrorComponents(indents: string[]): string {
   const [i1, i2, i3, i4] = indents;
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
export function buildAskComponents(ctx: PreloadContext): string {
   const [i1, i2, i3] = ctx.indents;
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
         ctx.usesSerializer
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

export function buildAskListener(ctx: PreloadContext, name: string): string {
   const [, i1] = ctx.indents;
   return [
      `ipcRenderer.on(${ctx.wireName(name)}, (_event: unknown, id: unknown, ...args: any[]) => {`,
      `${i1}void answerAsk('${name}', ${ctx.wireName(name, ":reply")}, id, args);`,
      "});",
      "",
   ].join("\n");
}
