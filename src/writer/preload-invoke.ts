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

/** The property of the exposed object for a channel with one method. */
export function buildChannel(
   indents: string[],
   name: string,
   method: string,
   implementation: string,
): ChannelEntry {
   const [i0, i1] = indents;
   return { name, property: `\n${i0}${name}: {\n${i1}${method}: ${implementation},\n${i0}},` };
}

/**
 * `ipc.<name>.invoke(...args)` for `invoke` channels and `ipc.<name>.send(...args)` for `send`.
 * An invoke gets the envelope of the main process: it returns the value of a successful reply
 * and rejects with the error object of a failed one. It rejects with the plain object
 * `{ name, message, code?, data? }`, not with an `Error`, since contextBridge copies a thrown
 * `Error` as a new `Error` with only the message and the stack, and loses the other fields.
 */
export function buildRendererToMainChannel(ctx: PreloadContext, spec: t.ChannelSpec): ChannelEntry {
   const method = spec.kind === "Broadcast" ? "send" : "invoke";
   const serialized = ctx.isSerializedSpec(spec);
   // A `send` throws synchronously, so its failure must carry the code in the message.
   const encode = spec.kind === "Broadcast" ? "encodeSync" : "encodeValue";
   const sent = serialized ? `${encode}('${spec.name}', args)` : "...args";
   let ipcRenderer = `ipcRenderer.${method}(${ctx.wireName(spec.name)}, ${sent})`;
   if (hasTimeout(ctx, spec)) {
      ipcRenderer = `withTimeout('${spec.name}', ${ctx.getTimeoutMs(spec)}, ${ipcRenderer})`;
   }
   const decode = (value: string) => (serialized ? `decodeValue('${spec.name}', ${value})` : value);
   if (spec.kind === "Unicast" && !ctx.config.rawErrors) {
      const [, i1, i2, i3] = ctx.indents;
      const implementation = [
         "async (...args: any[]) => {",
         `${i2}const result = await ${ipcRenderer};`,
         `${i2}if (result.ok) {`,
         `${i3}return ${decode("result.value")};`,
         `${i2}}`,
         `${i2}throw result.error;`,
         `${i1}}`,
      ].join("\n");
      return buildChannel(ctx.indents, spec.name, method, implementation);
   }
   if (serialized && spec.kind === "Unicast") {
      // A synchronous failure to serialize must reject the promise, not throw.
      const implementation = `async (...args: any[]) => ${decode(`await ${ipcRenderer}`)}`;
      return buildChannel(ctx.indents, spec.name, method, implementation);
   }
   return buildChannel(ctx.indents, spec.name, method, `(...args: any[]) => ${ipcRenderer}`);
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
export function buildSerializerComponents(indents: string[]): string {
   const [i1, i2] = indents;
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
export function getTimeoutComponents(ctx: PreloadContext, pfsArray: t.ParsedFileSpecs[]): string[] {
   const used = pfsArray.some((parsed) =>
      parsed.specs.channelSpecArray.some((spec) => hasTimeout(ctx, spec)),
   );
   return used ? [buildTimeoutComponents(ctx.indents)] : [];
}

/** Whether the promise of an `invoke` channel is rejected after a timeout. */
export function hasTimeout(ctx: PreloadContext, spec: t.ChannelSpec): boolean {
   return (
      spec.kind === "Unicast" && spec.direction === "RendererToMain" && ctx.getTimeoutMs(spec) > 0
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
function buildTimeoutComponents(indents: string[]): string {
   const [i1, i2, i3] = indents;
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
