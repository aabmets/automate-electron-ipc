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

import { CLAMPED_TIMEOUT } from "../generated-errors.js";
import type { PreloadContext } from "./preload-bindings.js";

/**
 * The calls and streams of the client of the channels to a utility process (see
 * `buildUtilityClientComponents`): `callUtilityPort`, and `openUtilityStream` when a channel streams.
 */
export function buildUtilityCalls(ctx: PreloadContext, streams: boolean): string[] {
   const [i1, i2, i3, i4] = ctx.indents;
   const serialized = ctx.usesSerializer;
   return [
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
      `${i3}}, ${CLAMPED_TIMEOUT});`,
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
              `${i2}}, ${CLAMPED_TIMEOUT});`,
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
   ];
}
