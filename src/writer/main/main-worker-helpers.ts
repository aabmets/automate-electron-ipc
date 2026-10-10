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
import utils from "../../utils.js";
import { askErrorLines, readAskReplyLines } from "./main-asks.js";
import type { MainContext } from "./main-bindings.js";
import {
   buildWorkerCallLines,
   buildWorkerSendLines,
   buildWorkerTimer,
} from "./main-worker-calls.js";
import { buildWorkerAskLines, buildWorkerRouting } from "./main-worker-routing.js";
import { buildWorkerSenders } from "./main-workers.js";

/**
 * The helpers of the channels between the main process and service workers.
 *
 * The messages of a service worker do not reach `ipcMain`: they go to the `ipc` of its
 * `ServiceWorkerMain`, and a worker can send from its preload script, before the app could
 * register anything on the object. So the main process keeps one hub per `Session`. It watches the
 * `running-status-changed` event of `session.serviceWorkers`, and routes every channel that a
 * worker calls on the `ipc` of each worker as it starts, to the callbacks that the hub holds. A
 * callback is registered per session, so it is there for every worker, also for one that starts
 * later. `attachServiceWorkers(session)` makes the hub, and `handle` and `on` do so as well.
 *
 * What a worker sends is untrusted. The event has no `senderFrame`, so a channel with
 * `allowedOrigins` compares them with the origin of the scope of the worker, and the
 * `validateSender` hook of `configureServiceWorkerIpc` sees the event, with `versionId` and
 * `serviceWorker.scope`. A call from a worker that is rejected throws an `IpcWorkerError`, and a
 * message is dropped. A reply to a question counts only when it comes from the worker that was
 * asked, on the reply channel of the channel, with an ID that is pending.
 *
 * A question keeps its worker alive with `startTask` until it is settled, and is rejected with the
 * code `IPC_ASK_DESTROYED` when the worker stops, or `IPC_ASK_NOT_ATTACHED` when no hub knows it.
 * `IpcMainServiceWorker` has no `off`, so a worker is only ever given routes, which look their
 * callbacks up when a message arrives.
 */
export function buildWorkerHelpers(
   ctx: MainContext,
   specs: t.ChannelSpec[],
   hasRendererAsks: boolean,
   validators: Map<t.ChannelSpec, string>,
): string {
   const [i1, i2] = ctx.indents;
   const validates = validators.size > 0;
   // An invalid call is reported to the hook, with the error, like a call that is forbidden.
   const reportInvalid =
      "(rejected, name, error) => workerConfig.onRejected?.(rejected, name, error)";
   const pick = (direction: t.ChannelDirection, kind: t.ChannelKind) =>
      specs
         .filter((spec) => spec.direction === direction && spec.kind === kind)
         .sort((a, b) => utils.compareStrings(a.name, b.name));
   const calls = pick("ServiceWorkerToMain", "Unicast");
   const sends = pick("ServiceWorkerToMain", "Broadcast");
   const asks = pick("MainToServiceWorker", "Unicast");
   const times = calls.some((spec) => ctx.getTimeoutMs(spec) > 0);
   const validatesCalls = calls.some((spec) => validators.has(spec));
   const validatesSends = sends.some((spec) => validators.has(spec));
   const inbound = calls.length > 0 || sends.length > 0;
   const events = [
      ...(calls.length > 0 ? ["IpcMainServiceWorkerInvokeEvent"] : []),
      ...(sends.length > 0 ? ["IpcMainServiceWorkerEvent"] : []),
   ].join(" | ");
   const out: string[] = [""];
   if (asks.length > 0 && !hasRendererAsks) {
      out.push(...askErrorLines(ctx.indents), ...readAskReplyLines(ctx.indents));
   }
   out.push(
      "export class IpcWorkerError extends Error {",
      `${i1}readonly code: string;`,
      `${i1}readonly channel: string;`,
      `${i1}constructor(channel: string, message: string, code: string) {`,
      `${i2}super(message);`,
      `${i2}this.name = 'IpcWorkerError';`,
      `${i2}this.channel = channel;`,
      `${i2}this.code = code;`,
      `${i1}}`,
      "}",
      "",
      ...buildWorkerConfigLines(ctx.indents, {
         inbound,
         events,
         hasAsks: asks.length > 0,
         validates,
         times,
      }),
   );
   const table = (name: string, list: t.ChannelSpec[], wire: (spec: t.ChannelSpec) => string) => [
      `const ${name}: WorkerChannelInfo[] = [`,
      ...list.map((spec) => describeWorkerChannel(ctx, spec, wire(spec), validators.get(spec))),
      "];",
      "",
   ];
   if (calls.length > 0) {
      out.push(...table("workerCalls", calls, (spec) => ctx.wireName(spec.name)));
   }
   if (sends.length > 0) {
      out.push(...table("workerSends", sends, (spec) => ctx.wireName(spec.name)));
   }
   if (asks.length > 0) {
      out.push(...table("workerAsks", asks, (spec) => ctx.wireName(spec.name, ":reply")));
   }
   out.push(
      ...buildWorkerHubTypes(i1, {
         hasCalls: calls.length > 0,
         hasSends: sends.length > 0,
         hasAsks: asks.length > 0,
      }),
   );
   if (inbound) {
      out.push(...buildWorkerSenderCheck(ctx.indents, events, validates));
   }
   if (calls.length > 0) {
      out.push(...buildWorkerCallLines(ctx, validatesCalls, reportInvalid));
   }
   if (sends.length > 0) {
      out.push(...buildWorkerSendLines(ctx, validatesSends, reportInvalid));
   }
   if (asks.length > 0) {
      out.push(...buildWorkerAskLines(ctx));
   }
   if (times) {
      out.push(...buildWorkerTimer(ctx.indents));
   }
   out.push(
      buildWorkerRouting(ctx, calls, sends, asks, times),
      ...buildWorkerSenders(ctx.indents, specs),
   );
   return out.join("\n");
}

/** The interfaces of the listeners, of the pending questions and of the hub of a session. */
function buildWorkerHubTypes(
   i1: string,
   has: { hasCalls: boolean; hasSends: boolean; hasAsks: boolean },
): string[] {
   const { hasCalls, hasSends, hasAsks } = has;
   return [
      ...(hasSends
         ? ["interface WorkerListener {", `${i1}callback: unknown;`, `${i1}once: boolean;`, "}", ""]
         : []),
      ...(hasAsks
         ? [
              "interface PendingWorkerAsk {",
              `${i1}channel: string;`,
              `${i1}versionId: number;`,
              `${i1}answer: (envelope: unknown) => void;`,
              `${i1}fail: (error: IpcAskError) => void;`,
              "}",
              "",
           ]
         : []),
      "interface WorkerHub {",
      ...(hasCalls ? [`${i1}handlers: { [channel: string]: unknown };`] : []),
      ...(hasSends ? [`${i1}listeners: { [channel: string]: WorkerListener[] | undefined };`] : []),
      ...(hasAsks ? [`${i1}asks: { [id: string]: PendingWorkerAsk | undefined };`] : []),
      "}",
      "",
      "const sessionHubs = new WeakMap<Session, WorkerHub>();",
      "const workerHubs = new WeakMap<ServiceWorkerMain, WorkerHub>();",
      ...(hasAsks ? ["let lastWorkerAskId = 0;"] : []),
      "",
   ];
}

/** `IpcWorkerConfig`, `configureServiceWorkerIpc` and the type of the entries of the tables of channels. */
function buildWorkerConfigLines(
   indents: string[],
   w: {
      inbound: boolean;
      events: string;
      hasAsks: boolean;
      validates: boolean;
      times: boolean;
   },
): string[] {
   const [i1] = indents;
   const { events, validates, times } = w;
   if (w.inbound) {
      return [
         "export interface IpcWorkerConfig {",
         `${i1}validateSender?: (event: ${events}, channel: string) => boolean;`,
         `${i1}onRejected?: (event: ${events}, channel: string${validates ? ", error: IpcWorkerError | IpcValidationError" : ""}) => void;`,
         "}",
         "",
         "let workerConfig: IpcWorkerConfig = {};",
         "",
         "export function configureServiceWorkerIpc(config: IpcWorkerConfig): void {",
         `${i1}workerConfig = { validateSender: config.validateSender, onRejected: config.onRejected };`,
         "}",
         "",
         "interface WorkerChannelInfo {",
         `${i1}channel: string;`,
         `${i1}wire: string;`,
         `${i1}allowedOrigins?: string[];`,
         ...(validates ? [`${i1}validator?: IpcArgumentsSchema;`] : []),
         ...(times ? [`${i1}timeoutMs?: number;`] : []),
         "}",
         "",
      ];
   }
   return w.hasAsks
      ? ["interface WorkerChannelInfo {", `${i1}channel: string;`, `${i1}wire: string;`, "}", ""]
      : [];
}

function describeWorkerChannel(
   ctx: MainContext,
   spec: t.ChannelSpec,
   wire: string,
   validator?: string,
): string {
   const origins = spec.allowedOrigins
      ? `, allowedOrigins: [${spec.allowedOrigins.map((origin) => JSON.stringify(origin)).join(", ")}]`
      : "";
   const validated = validator === undefined ? "" : `, validator: ${validator}`;
   const timeoutMs = spec.direction === "ServiceWorkerToMain" ? ctx.getTimeoutMs(spec) : 0;
   const timed = timeoutMs > 0 && spec.kind === "Unicast" ? `, timeoutMs: ${timeoutMs}` : "";
   return `${ctx.indents[0]}{ channel: '${spec.name}', wire: ${wire}${origins}${validated}${timed} },`;
}

/** `getWorkerOrigin` and `isWorkerAllowed`, which the routes call first. */
function buildWorkerSenderCheck(indents: string[], events: string, validates: boolean): string[] {
   const [i1, i2, i3] = indents;
   return [
      "function getWorkerOrigin(scope: string): string | null {",
      `${i1}try {`,
      `${i2}const url = new URL(scope);`,
      `${i2}// The origin of a scheme that is not special is "null", while a frame reports scheme://host.`,
      `${i2}return url.origin !== 'null' ? url.origin : \`\${url.protocol}//\${url.host}\`;`,
      `${i1}} catch {`,
      `${i2}return null;`,
      `${i1}}`,
      "}",
      "",
      `function isWorkerAllowed(worker: ServiceWorkerMain, event: ${events}, channel: string, allowedOrigins?: string[]): boolean {`,
      `${i1}const validateSender = workerConfig.validateSender;`,
      `${i1}if (!allowedOrigins && !validateSender) {`,
      `${i2}return true;`,
      `${i1}}`,
      `${i1}let allowed = false;`,
      `${i1}try {`,
      `${i2}const origin = getWorkerOrigin(worker.scope);`,
      `${i2}allowed =`,
      `${i3}(!allowedOrigins || (origin !== null && allowedOrigins.includes(origin))) &&`,
      `${i3}(!validateSender || validateSender(event, channel) === true);`,
      `${i1}} catch {`,
      `${i2}allowed = false;`,
      `${i1}}`,
      `${i1}if (!allowed && workerConfig.onRejected) {`,
      `${i2}try {`,
      validates
         ? `${i3}workerConfig.onRejected(event, channel, new IpcWorkerError(channel, \`The service worker is not allowed to use the channel '\${channel}'\`, 'IPC_WORKER_FORBIDDEN'));`
         : `${i3}workerConfig.onRejected(event, channel);`,
      `${i2}} catch {`,
      `${i3}// A failing hook must not decide whether the call is rejected.`,
      `${i2}}`,
      `${i1}}`,
      `${i1}return allowed;`,
      "}",
      "",
   ];
}
