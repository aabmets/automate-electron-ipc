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

/** The calls and sends of a service worker to the main process, and their timeouts. */

/**
 * `timeWorkerCall`, which rejects the call of a worker that the handler has not answered in time.
 * The preload script of a worker has no timers, so the main process times its calls. The error is
 * answered in the envelope, so it reaches the worker as the plain object `{ name:
 * 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' }`, like the timeout of a page. The handler is not
 * stopped, and its late reply is dropped. The timer is cleared as soon as the handler settles.
 */
export function buildWorkerTimer(indents: string[]): string[] {
   const [i1, i2, i3] = indents;
   return [
      "function timeWorkerCall(info: WorkerChannelInfo, result: unknown): unknown {",
      `${i1}const timeoutMs = info.timeoutMs;`,
      `${i1}if (!timeoutMs || !result || typeof (result as Promise<unknown>).then !== 'function') {`,
      `${i2}return result;`,
      `${i1}}`,
      `${i1}return new Promise<unknown>((resolve, reject) => {`,
      `${i2}const timer = setTimeout(() => {`,
      `${i3}const message = \`The channel '\${info.channel}' did not answer within \${timeoutMs} ms\`;`,
      `${i3}reject(Object.assign(new Error(message), { name: 'IpcTimeoutError', code: 'IPC_TIMEOUT' }));`,
      `${i2}}, Math.min(timeoutMs, 2147483647));`,
      `${i2}(result as Promise<unknown>).then(`,
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
   ];
}

/** `callWorkerHandler` and the registration of the handlers of the calls of a worker, with the validation of the arguments if a channel has a validator. */
export function buildWorkerCallLines(
   ctx: MainContext,
   validated: boolean,
   reportInvalid: string,
): string[] {
   const [i1, i2, i3] = ctx.indents;
   const serialized = ctx.usesSerializer;
   return [
      "function callWorkerHandler(",
      `${i1}hub: WorkerHub,`,
      `${i1}worker: ServiceWorkerMain,`,
      `${i1}event: IpcMainServiceWorkerInvokeEvent,`,
      `${i1}info: WorkerChannelInfo,`,
      `${i1}args: unknown[],`,
      "): unknown {",
      `${i1}if (!isWorkerAllowed(worker, event, info.channel, info.allowedOrigins)) {`,
      `${i2}throw new IpcWorkerError(info.channel, \`The service worker is not allowed to use the channel '\${info.channel}'\`, 'IPC_WORKER_FORBIDDEN');`,
      `${i1}}`,
      ...(validated
         ? [
              `${i1}const missing = () => new IpcWorkerError(info.channel, \`No handler is registered for the channel '\${info.channel}'\`, 'IPC_WORKER_NO_HANDLER');`,
              `${i1}if (!hub.handlers[info.channel]) {`,
              `${i2}throw missing();`,
              `${i1}}`,
              ...(serialized
                 ? [
                      `${i1}// The sender is checked first, so that a rejected worker reaches no code of the serializer.`,
                      `${i1}const decoded = readArguments(info.channel, args);`,
                   ]
                 : []),
              `${i1}// The handler is looked up when the arguments are valid, since a schema may take its time`,
              `${i1}// and a handler of \`handleOnce\` may have been used up by then.`,
              `${i1}const run = (valid: unknown[]): unknown => {`,
              `${i2}const handler = hub.handlers[info.channel] as ((...handlerArgs: unknown[]) => unknown) | undefined;`,
              `${i2}if (!handler) {`,
              `${i3}throw missing();`,
              `${i2}}`,
              `${i2}return handler(event, ...valid);`,
              `${i1}};`,
              `${i1}return info.validator`,
              `${i2}? validateArguments(event, info.channel, info.validator, ${serialized ? "decoded" : "args"}, false, run, ${reportInvalid})`,
              `${i2}: run(${serialized ? "decoded" : "args"});`,
           ]
         : [
              `${i1}const handler = hub.handlers[info.channel] as ((...handlerArgs: unknown[]) => unknown) | undefined;`,
              `${i1}if (!handler) {`,
              `${i2}throw new IpcWorkerError(info.channel, \`No handler is registered for the channel '\${info.channel}'\`, 'IPC_WORKER_NO_HANDLER');`,
              `${i1}}`,
              `${i1}return handler(event, ...${serialized ? "readArguments(info.channel, args)" : "args"});`,
           ]),
      "}",
      "",
      "function registerWorkerHandler(session: Session, channel: string, callback: unknown, once: boolean): () => void {",
      `${i1}const hub = getWorkerHub(session);`,
      `${i1}const handler = once`,
      `${i2}? (event: unknown, ...args: unknown[]) => {`,
      `${i3}remove();`,
      `${i3}return (callback as (...handlerArgs: unknown[]) => unknown)(event, ...args);`,
      `${i2}}`,
      `${i2}: callback;`,
      `${i1}const remove = (): void => {`,
      `${i2}if (hub.handlers[channel] === handler) {`,
      `${i3}delete hub.handlers[channel];`,
      `${i2}}`,
      `${i1}};`,
      `${i1}hub.handlers[channel] = handler;`,
      `${i1}return remove;`,
      "}",
      "",
   ];
}

/** `dispatchWorkerSend` and the registration of the listeners of the messages of a worker, with the validation of the arguments if a channel has a validator. */
export function buildWorkerSendLines(
   ctx: MainContext,
   validated: boolean,
   reportInvalid: string,
): string[] {
   const [i1, i2, i3, i4] = ctx.indents;
   const serialized = ctx.usesSerializer;
   // A message that cannot be read is logged and dropped, and does not use up a `once` listener.
   const decode = (name: string): string[] =>
      serialized
         ? [
              `${i1}const ${name} = readSentArguments(info.channel, args);`,
              `${i1}if (!${name}) {`,
              `${i2}return;`,
              `${i1}}`,
           ]
         : [];
   return [
      "function dispatchWorkerSend(",
      `${i1}hub: WorkerHub,`,
      `${i1}worker: ServiceWorkerMain,`,
      `${i1}event: IpcMainServiceWorkerEvent,`,
      `${i1}info: WorkerChannelInfo,`,
      `${i1}args: unknown[],`,
      "): void {",
      `${i1}if (!isWorkerAllowed(worker, event, info.channel, info.allowedOrigins)) {`,
      `${i2}return;`,
      `${i1}}`,
      ...(validated
         ? [
              `${i1}if (!hub.listeners[info.channel]) {`,
              `${i2}return;`,
              `${i1}}`,
              ...decode("decoded"),
              `${i1}// The listeners are looked up when the arguments are valid, since a schema may take its time`,
              `${i1}// and a listener of \`once\` may have been used up by then.`,
              `${i1}const run = (valid: unknown[]): void => {`,
              `${i2}const listeners = hub.listeners[info.channel];`,
              `${i2}if (!listeners) {`,
              `${i3}return;`,
              `${i2}}`,
              `${i2}for (const entry of listeners.slice()) {`,
              `${i3}if (entry.once) {`,
              `${i4}const at = listeners.indexOf(entry);`,
              `${i4}if (at < 0) {`,
              `${i4}${i1}continue;`,
              `${i4}}`,
              `${i4}listeners.splice(at, 1);`,
              `${i3}}`,
              `${i3}try {`,
              `${i4}(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...valid);`,
              `${i3}} catch (error) {`,
              `${i4}console.error(error);`,
              `${i3}}`,
              `${i2}}`,
              `${i1}};`,
              `${i1}if (info.validator) {`,
              `${i2}void validateArguments(event, info.channel, info.validator, ${serialized ? "decoded" : "args"}, true, run, ${reportInvalid});`,
              `${i1}} else {`,
              `${i2}run(${serialized ? "decoded" : "args"});`,
              `${i1}}`,
           ]
         : [
              `${i1}const listeners = hub.listeners[info.channel];`,
              `${i1}if (!listeners) {`,
              `${i2}return;`,
              `${i1}}`,
              ...decode("decoded"),
              `${i1}for (const entry of listeners.slice()) {`,
              `${i2}if (entry.once) {`,
              `${i3}const at = listeners.indexOf(entry);`,
              `${i3}if (at < 0) {`,
              `${i4}continue;`,
              `${i3}}`,
              `${i3}listeners.splice(at, 1);`,
              `${i2}}`,
              `${i2}try {`,
              `${i3}(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...${serialized ? "decoded" : "args"});`,
              `${i2}} catch (error) {`,
              `${i3}console.error(error);`,
              `${i2}}`,
              `${i1}}`,
           ]),
      "}",
      "",
      "function addWorkerListener(session: Session, channel: string, callback: unknown, once: boolean): () => void {",
      `${i1}const hub = getWorkerHub(session);`,
      `${i1}const entry: WorkerListener = { callback, once };`,
      `${i1}const listeners = hub.listeners[channel] ?? [];`,
      `${i1}listeners.push(entry);`,
      `${i1}hub.listeners[channel] = listeners;`,
      `${i1}return () => {`,
      `${i2}const at = listeners.indexOf(entry);`,
      `${i2}if (at >= 0) {`,
      `${i3}listeners.splice(at, 1);`,
      `${i2}}`,
      `${i1}};`,
      "}",
      "",
   ];
}
