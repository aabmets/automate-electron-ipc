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
import { CLAMPED_TIMEOUT } from "../generated-errors.js";
import type { MainContext } from "./main-bindings.js";

/** The routes that a hub gives each service worker, and the questions of the main process to a worker. */

/**
 * `answerWorkerAsk`, `failWorkerAsks` and `askServiceWorker`: the questions to a worker, and the
 * answers that settle them.
 */
export function buildWorkerAskLines(ctx: MainContext): string[] {
   const [i1, i2, i3, i4] = ctx.indents;
   return [
      "function answerWorkerAsk(hub: WorkerHub, versionId: number, info: WorkerChannelInfo, id: unknown, envelope: unknown): void {",
      `${i1}const pending = typeof id === 'number' ? hub.asks[id] : undefined;`,
      `${i1}if (pending && pending.channel === info.channel && pending.versionId === versionId) {`,
      `${i2}pending.answer(envelope);`,
      `${i1}}`,
      "}",
      "",
      "function failWorkerAsks(hub: WorkerHub, versionId: number): void {",
      `${i1}for (const pending of Object.values(hub.asks)) {`,
      `${i2}if (pending && pending.versionId === versionId) {`,
      `${i3}pending.fail(new IpcAskError(pending.channel, \`The service worker that was asked on the channel '\${pending.channel}' has stopped\`, 'IPC_ASK_DESTROYED'));`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
      "function askServiceWorker(",
      `${i1}channel: string,`,
      `${i1}wire: string,`,
      `${i1}worker: ServiceWorkerMain,`,
      `${i1}args: unknown[],`,
      `${i1}options?: IpcAskOptions,`,
      "): Promise<unknown> {",
      `${i1}return new Promise<unknown>((resolve, reject) => {`,
      `${i2}const timeoutMs = options?.timeoutMs;`,
      `${i2}if (timeoutMs !== undefined && !(typeof timeoutMs === 'number' && timeoutMs >= 0)) {`,
      `${i3}throw new TypeError('timeoutMs must be a number which is not negative');`,
      `${i2}}`,
      `${i2}const hub = workerHubs.get(worker);`,
      `${i2}if (!hub) {`,
      `${i3}reject(new IpcAskError(channel, 'The service worker is not known to the bindings. Call attachServiceWorkers(session) for its session first', 'IPC_ASK_NOT_ATTACHED'));`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const destroyed = new IpcAskError(channel, \`The service worker that was asked on the channel '\${channel}' is gone\`, 'IPC_ASK_DESTROYED');`,
      `${i2}let versionId = 0;`,
      `${i2}let isGone = false;`,
      `${i2}try {`,
      `${i3}isGone = worker.isDestroyed();`,
      `${i3}versionId = worker.versionId;`,
      `${i2}} catch {`,
      `${i3}isGone = true;`,
      `${i2}}`,
      `${i2}if (isGone) {`,
      `${i3}reject(destroyed);`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const id = ++lastWorkerAskId;`,
      `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
      `${i2}let task: { end: () => void } | undefined;`,
      `${i2}const finish = (settle: () => void): void => {`,
      `${i3}clearTimeout(timer);`,
      `${i3}delete hub.asks[id];`,
      `${i3}try {`,
      `${i4}task?.end();`,
      `${i3}} catch {`,
      `${i4}// The worker is gone, and so is its task.`,
      `${i3}}`,
      `${i3}settle();`,
      `${i2}};`,
      `${i2}hub.asks[id] = {`,
      `${i3}channel,`,
      `${i3}versionId,`,
      `${i3}answer: (envelope) => {`,
      ...(ctx.usesSerializer
         ? [
              `${i4}let outcome = readAskReply(channel, envelope, 'service worker');`,
              `${i4}if (!('error' in outcome)) {`,
              `${i4}${i1}try {`,
              `${i4}${i2}outcome = { value: decodeValue(channel, outcome.value) };`,
              `${i4}${i1}} catch (cause) {`,
              `${i4}${i2}outcome = { error: new IpcAskError(channel, \`The answer cannot be read: \${cause instanceof Error ? cause.message : String(cause)}\`, 'IPC_ASK_INVALID_REPLY') };`,
              `${i4}${i1}}`,
              `${i4}}`,
              `${i4}const settled = outcome;`,
           ]
         : [`${i4}const settled = readAskReply(channel, envelope, 'service worker');`]),
      `${i4}finish(() => ('error' in settled ? reject(settled.error) : resolve(settled.value)));`,
      `${i3}},`,
      `${i3}fail: (error) => finish(() => reject(error)),`,
      `${i2}};`,
      `${i2}if (timeoutMs !== undefined && timeoutMs !== Infinity) {`,
      `${i3}const error = new IpcAskError(channel, \`The service worker did not answer the channel '\${channel}' within \${timeoutMs} ms\`, 'IPC_ASK_TIMEOUT');`,
      `${i3}timer = setTimeout(() => finish(() => reject(error)), ${CLAMPED_TIMEOUT});`,
      `${i2}}`,
      `${i2}try {`,
      ...(ctx.usesSerializer ? [`${i3}const question = encodeValue(channel, args);`] : []),
      `${i3}// Keeps the worker from stopping while it is asked.`,
      `${i3}task = worker.startTask();`,
      `${i3}worker.send(wire, id, ${ctx.usesSerializer ? "question" : "...args"});`,
      `${i2}} catch (error) {`,
      `${i3}finish(() => reject(error));`,
      `${i2}}`,
      `${i1}});`,
      "}",
      "",
   ];
}

/** `routeWorker`, `getWorkerHub` and `attachServiceWorkers`, which connect the hubs to the workers. */
export function buildWorkerRouting(
   ctx: MainContext,
   calls: t.ChannelSpec[],
   sends: t.ChannelSpec[],
   asks: t.ChannelSpec[],
   times: boolean,
): string {
   const [i1, i2, i3, i4] = ctx.indents;
   const route: string[] = [];
   if (calls.length > 0) {
      const call = "callWorkerHandler(hub, worker, event, info, args)";
      const timed = times ? `timeWorkerCall(info, ${call})` : call;
      // A serialized result is encoded once the handler has answered in time.
      const result = ctx.usesSerializer ? `encodeValue(info.channel, await ${timed})` : timed;
      const params = "event: IpcMainServiceWorkerInvokeEvent, ...args: unknown[]";
      const settle = ctx.usesSerializer ? `async () => ${result}` : `() => ${timed}`;
      route.push(
         `${i1}for (const info of workerCalls) {`,
         ctx.config.rawErrors
            ? ctx.usesSerializer
               ? `${i2}worker.ipc.handle(info.wire, async (${params}) =>`
               : `${i2}worker.ipc.handle(info.wire, (${params}) =>`
            : `${i2}worker.ipc.handle(info.wire, (${params}) =>`,
         ctx.config.rawErrors ? `${i3}${result},` : `${i3}settleInvoke(${settle}),`,
         `${i2});`,
         `${i1}}`,
      );
   }
   if (sends.length > 0) {
      route.push(
         `${i1}for (const info of workerSends) {`,
         `${i2}worker.ipc.on(info.wire, (event: IpcMainServiceWorkerEvent, ...args: unknown[]) =>`,
         `${i3}dispatchWorkerSend(hub, worker, event, info, args),`,
         `${i2});`,
         `${i1}}`,
      );
   }
   if (asks.length > 0) {
      route.push(
         `${i1}const versionId = worker.versionId;`,
         `${i1}for (const info of workerAsks) {`,
         `${i2}worker.ipc.on(info.wire, (_event: unknown, id: unknown, envelope: unknown) =>`,
         `${i3}answerWorkerAsk(hub, versionId, info, id, envelope),`,
         `${i2});`,
         `${i1}}`,
      );
   }
   return [
      "function routeWorker(hub: WorkerHub, worker: ServiceWorkerMain): void {",
      `${i1}if (workerHubs.has(worker)) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}workerHubs.set(worker, hub);`,
      ...route,
      "}",
      "",
      "function getWorkerHub(session: Session): WorkerHub {",
      `${i1}const known = sessionHubs.get(session);`,
      `${i1}if (known) {`,
      `${i2}return known;`,
      `${i1}}`,
      `${i1}const hub: WorkerHub = {`,
      ...(calls.length > 0
         ? [`${i2}handlers: { __proto__: null } as unknown as WorkerHub['handlers'],`]
         : []),
      ...(sends.length > 0
         ? [`${i2}listeners: { __proto__: null } as unknown as WorkerHub['listeners'],`]
         : []),
      ...(asks.length > 0
         ? [`${i2}asks: { __proto__: null } as unknown as WorkerHub['asks'],`]
         : []),
      `${i1}};`,
      `${i1}sessionHubs.set(session, hub);`,
      `${i1}const serviceWorkers = session.serviceWorkers;`,
      `${i1}const route = (versionId: number): void => {`,
      `${i2}try {`,
      `${i3}const worker = serviceWorkers.getWorkerFromVersionID(versionId);`,
      `${i3}if (worker) {`,
      `${i4}routeWorker(hub, worker);`,
      `${i3}}`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}};`,
      `${i1}serviceWorkers.on('running-status-changed', (details) => {`,
      `${i2}if (details.runningStatus === 'starting' || details.runningStatus === 'running') {`,
      `${i3}route(details.versionId);`,
      ...(asks.length > 0
         ? [
              `${i2}} else {`,
              `${i3}// A worker that is stopping cannot answer any more.`,
              `${i3}failWorkerAsks(hub, details.versionId);`,
           ]
         : []),
      `${i2}}`,
      `${i1}});`,
      `${i1}for (const id of Object.keys(serviceWorkers.getAllRunning())) {`,
      `${i2}route(Number(id));`,
      `${i1}}`,
      `${i1}return hub;`,
      "}",
      "",
      "/**",
      " * Starts watching the service workers of the session, so that the messages of a worker are",
      " * routed from its first line on. `handle` and `on` do this as well, and a question to a worker",
      " * (`invoke`) needs it. Call it with `session.defaultSession`, or the session of the window.",
      " */",
      "export function attachServiceWorkers(session: Session): void {",
      `${i1}getWorkerHub(session);`,
      "}",
      "",
   ].join("\n");
}
