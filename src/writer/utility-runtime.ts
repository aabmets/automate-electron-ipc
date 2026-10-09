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
import type { ImportsGenerator } from "./imports-generator.js";

/**
 * The generated runtime code which `main.ts` and `utility.ts` share. Both files hold their own copy
 * of it, since a generated file must not depend on this library or on the other file.
 */

/**
 * The names that the code of `buildUtilityPeer` and `buildErrorEnvelope` declares or uses, which a
 * schema type of the same name must not shadow.
 */
export const UTILITY_RUNTIME_NAMES = [
   "IpcErrorInfo",
   "IpcEnvelope",
   "toIpcError",
   "settleInvoke",
   "IpcUtilityError",
   "UtilityPending",
   "UtilityCallback",
   "UtilityPeer",
   "lastUtilityCallId",
   "createUtilityPeer",
   "closeUtilityPeer",
   "unsendableUtilityError",
   "readUtilityReply",
   "sendUtilityReply",
   "receiveUtilityMessage",
   "callUtilityPeer",
   "sendUtilityPeer",
   "setUtilityHandler",
   "addUtilityListener",
   "Map",
   "Set",
   "setTimeout",
   "clearTimeout",
   "Error",
   "TypeError",
   "Promise",
   "Array",
   "structuredClone",
];

/**
 * The import line of the serializer. The generated code refers to it through the aliases
 * `ipcSerialize` and `ipcDeserialize`, and casts them, since the module's own types are free.
 */
export function buildSerializerImport(
   { serializer, serializerFilePath }: t.IPCResolvedConfig,
   importsGenerator: ImportsGenerator,
): string {
   const from =
      serializerFilePath === undefined
         ? serializer
         : importsGenerator.getFileImportPath(serializerFilePath);
   return `import { serialize as ipcSerialize, deserialize as ipcDeserialize } from ${JSON.stringify(from)};`;
}

/**
 * The serializer of the config, for the files that talk to the other side of a channel with it:
 * `encodeValue` turns what is sent into the wire value and `decodeValue` turns it back; the
 * arguments of a call travel as one value, the list of them. `IpcSerializationError` is what a
 * failure throws. `readArguments` throws for a call that answers, and `readSentArguments` drops a
 * message that nobody answers, so that a bad message is logged and does not become an uncaught
 * error of the process. The code refers to the serializer through `ipcSerialize` and
 * `ipcDeserialize`, which the file imports.
 */
export function buildSerializerRuntime(indents: string[]): string {
   const [i1, i2] = indents;
   return [
      "",
      "export class IpcSerializationError extends Error {",
      `${i1}readonly code = 'IPC_SERIALIZATION';`,
      `${i1}readonly channel: string;`,
      `${i1}constructor(channel: string, what: string, cause: unknown) {`,
      `${i2}super(\`\${what} of the channel '\${channel}': \${cause instanceof Error ? cause.message : String(cause)}\`);`,
      `${i2}this.name = 'IpcSerializationError';`,
      `${i2}this.channel = channel;`,
      `${i1}}`,
      "}",
      "",
      "function encodeValue(channel: string, value: unknown): unknown {",
      `${i1}try {`,
      `${i2}return (ipcSerialize as (value: unknown) => unknown)(value);`,
      `${i1}} catch (cause) {`,
      `${i2}throw new IpcSerializationError(channel, 'The data cannot be serialized', cause);`,
      `${i1}}`,
      "}",
      "",
      "function decodeValue(channel: string, wire: unknown): unknown {",
      `${i1}try {`,
      `${i2}return (ipcDeserialize as (wire: unknown) => unknown)(wire);`,
      `${i1}} catch (cause) {`,
      `${i2}throw new IpcSerializationError(channel, 'The data cannot be deserialized', cause);`,
      `${i1}}`,
      "}",
      "",
      "function readArguments(channel: string, received: unknown[]): unknown[] {",
      `${i1}const value = received.length === 1 ? decodeValue(channel, received[0]) : undefined;`,
      `${i1}if (!Array.isArray(value)) {`,
      `${i2}throw new IpcSerializationError(channel, 'The arguments are not a list', 'the message has an unknown shape');`,
      `${i1}}`,
      `${i1}return value;`,
      "}",
      "",
      "function readSentArguments(channel: string, received: unknown[]): unknown[] | undefined {",
      `${i1}try {`,
      `${i2}return readArguments(channel, received);`,
      `${i1}} catch (error) {`,
      `${i2}console.error(error);`,
      `${i2}return undefined;`,
      `${i1}}`,
      "}",
      "",
   ].join("\n");
}

/**
 * The envelope of the answers of `invoke`-like channels: `settleInvoke` runs the handler and answers
 * with `{ ok: true, value }`, or with `{ ok: false, error }` when anything fails. `toIpcError`
 * reduces what was thrown to `{ name, message, code?, data? }`. The stack never leaves the process.
 * `data` is dropped when it cannot be cloned, since it would otherwise fail the whole reply.
 */
export function buildErrorEnvelope(indents: string[]): string {
   const [i1, i2, i3] = indents;
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
      `${i3}${i1}info.data = structuredClone(source.data);`,
      `${i3}} catch {`,
      `${i3}${i1}// Data that cannot be cloned is left out.`,
      `${i3}}`,
      `${i2}}`,
      `${i2}return info;`,
      `${i1}} catch {`,
      `${i2}return { name: 'Error', message: 'The handler failed with an unreadable error' };`,
      `${i1}}`,
      "}",
      "",
      "async function settleInvoke(run: () => unknown): Promise<IpcEnvelope> {",
      `${i1}try {`,
      `${i2}return { ok: true, value: await run() };`,
      `${i1}} catch (error) {`,
      `${i2}return { ok: false, error: toIpcError(error) };`,
      `${i1}}`,
      "}",
      "",
   ].join("\n");
}
