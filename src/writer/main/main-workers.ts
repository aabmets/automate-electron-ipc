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
import type { ChannelEntry, MainContext } from "./main-bindings.js";

/**
 * The names that the helpers of the channels to a service worker declare, import or use, which a
 * schema type of the same name must not shadow.
 */
export const WORKER_RESERVED_NAMES = [
   "IpcWorkerError",
   "IpcWorkerConfig",
   "workerConfig",
   "configureServiceWorkerIpc",
   "WorkerChannelInfo",
   "WorkerListener",
   "PendingWorkerAsk",
   "WorkerHub",
   "sessionHubs",
   "workerHubs",
   "workerCalls",
   "workerSends",
   "workerAsks",
   "lastWorkerAskId",
   "attachServiceWorkers",
   "getWorkerHub",
   "routeWorker",
   "getWorkerOrigin",
   "isWorkerAllowed",
   "callWorkerHandler",
   "timeWorkerCall",
   "dispatchWorkerSend",
   "answerWorkerAsk",
   "failWorkerAsks",
   "registerWorkerHandler",
   "addWorkerListener",
   "sendToWorker",
   "broadcastToWorkers",
   "askServiceWorker",
   "Session",
   "ServiceWorkerMain",
   "IpcMainServiceWorkerEvent",
   "IpcMainServiceWorkerInvokeEvent",
   "WeakMap",
   "URL",
   "Object",
   "Number",
   "console",
];

export function usesWorkerEnvelope(ctx: MainContext, spec: t.ChannelSpec): boolean {
   return (
      spec.direction === "ServiceWorkerToMain" && spec.kind === "Unicast" && !ctx.config.rawErrors
   );
}

export function addWorkerImports(specs: t.ChannelSpec[], types: Set<string>): void {
   if (specs.length === 0) {
      return;
   }
   types.add("Session");
   types.add("ServiceWorkerMain");
   for (const spec of specs) {
      if (spec.direction === "ServiceWorkerToMain") {
         types.add(getWorkerEventType(spec));
      }
   }
}

/**
 * Electron passes an `IpcMainServiceWorkerInvokeEvent` to `handle` listeners and an
 * `IpcMainServiceWorkerEvent` to `on` listeners. Neither has a `senderFrame`.
 */
export function getWorkerEventType(spec: t.ChannelSpec): string {
   return spec.kind === "Broadcast"
      ? "IpcMainServiceWorkerEvent"
      : "IpcMainServiceWorkerInvokeEvent";
}

/** `sendToWorker` and `broadcastToWorkers`, which the `send` and `broadcast` of the channels to a worker call. */
export function buildWorkerSenders(indents: string[], specs: t.ChannelSpec[]): string[] {
   const [i1, i2, i3] = indents;
   if (
      !specs.some((spec) => spec.direction === "MainToServiceWorker" && spec.kind === "Broadcast")
   ) {
      return [];
   }
   return [
      "function sendToWorker(channel: string, wire: string, worker: ServiceWorkerMain, args: unknown[]): void {",
      `${i1}if (worker.isDestroyed()) {`,
      `${i2}throw new IpcWorkerError(channel, \`The service worker that the channel '\${channel}' was sent to is gone\`, 'IPC_WORKER_DESTROYED');`,
      `${i1}}`,
      `${i1}worker.send(wire, ...args);`,
      "}",
      "",
      "function broadcastToWorkers(wire: string, session: Session, args: unknown[]): void {",
      `${i1}const serviceWorkers = session.serviceWorkers;`,
      `${i1}for (const id of Object.keys(serviceWorkers.getAllRunning())) {`,
      `${i2}try {`,
      `${i3}const worker = serviceWorkers.getWorkerFromVersionID(Number(id));`,
      `${i3}if (worker && !worker.isDestroyed()) {`,
      `${i3}${i1}worker.send(wire, ...args);`,
      `${i3}}`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
   ];
}

/**
 * `handle(session, callback)` and `handleOnce` of an `invokeFromWorker` channel, `on(session,
 * callback)` and `once` of a `sendFromWorker` channel, `send(worker, ...args)` and
 * `broadcast(session, ...args)` of an `emitToWorker` channel, and `invoke(worker, ...args)` and
 * `invokeWith(worker, { timeoutMs }, ...args)` of an `askWorker` channel.
 */
export function buildWorkerChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   const [, i1, i2] = ctx.indents;
   // The names of the generated parameters must not shadow a parameter of the signature.
   const taken = ctx.collectIdentifiers([spec.signature.definition]);
   const sessionName = ctx.uniqueName("session", taken);
   const workerName = ctx.uniqueName("worker", taken);
   const callbackName = ctx.uniqueName("callback", taken);
   const optionsName = ctx.uniqueName("options", taken);
   const eventName = ctx.uniqueName("event", taken);
   const channel = `'${spec.name}'`;
   const wire = ctx.wireName(spec.name);
   const typeParams = ctx.getTypeParams(spec.signature);
   const params = (...generated: string[]) =>
      [...generated, ctx.getOriginalParams(spec, false)].filter(Boolean).join(", ");
   const senderParams = ctx.getOriginalParams(spec, true);
   // A serialized message is one argument, the list of the arguments, as the serializer made it.
   const serialized = ctx.usesSerializer;
   const wired = serialized ? `encodeValue('${spec.name}', [${senderParams}])` : senderParams;
   const rest = serialized ? `[${wired}]` : senderParams ? `[${senderParams}]` : "[]";
   // A question is serialized by `askServiceWorker`, so that a failure rejects the promise.
   const askArgs = senderParams ? `[${senderParams}]` : "[]";
   if (spec.direction === "ServiceWorkerToMain") {
      const eventType = getWorkerEventType(spec);
      const signature = ctx.injectEventTypehint(spec.signature, eventType, eventName);
      const callback = `${callbackName}: ${signature}`;
      const methods =
         spec.kind === "Broadcast"
            ? [
                 ["on", "addWorkerListener", false],
                 ["once", "addWorkerListener", true],
              ]
            : [
                 ["handle", "registerWorkerHandler", false],
                 ["handleOnce", "registerWorkerHandler", true],
              ];
      return {
         name: spec.name,
         members: methods.flatMap(([method, helper, once]) => [
            `\n${i1}${method}: (${sessionName}: Session, ${callback}): (() => void) =>`,
            `\n${i2}${helper}(${sessionName}, ${channel}, ${callbackName}, ${once}),`,
         ]),
      };
   }
   if (spec.kind === "Broadcast") {
      return {
         name: spec.name,
         members: [
            `\n${i1}send: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`)}): void =>`,
            `\n${i2}sendToWorker(${channel}, ${wire}, ${workerName}, ${rest}),`,
            `\n${i1}broadcast: ${typeParams}(${params(`${sessionName}: Session`)}): void =>`,
            `\n${i2}broadcastToWorkers(${wire}, ${sessionName}, ${rest}),`,
         ],
      };
   }
   const returned = spec.signature.async
      ? spec.signature.returnType
      : `Promise<Awaited<${spec.signature.returnType}>>`;
   const ask = (options: string) =>
      `askServiceWorker(${channel}, ${wire}, ${workerName}, ${askArgs}${options}) as ${returned}`;
   return {
      name: spec.name,
      members: [
         `\n${i1}invoke: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`)}): ${returned} =>`,
         `\n${i2}${ask("")},`,
         `\n${i1}invokeWith: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`, `${optionsName}: IpcAskOptions`)}): ${returned} =>`,
         `\n${i2}${ask(`, ${optionsName}`)},`,
      ],
   };
}
