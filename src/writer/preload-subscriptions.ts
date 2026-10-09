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
 * `ipc.<name>.on(callback)` and `ipc.<name>.once(callback)`. The subscription is created here,
 * in the preload script, because contextBridge hands over a new proxy of the callback on every
 * crossing, so a separate `off(callback)` could not find it. Each method returns a function
 * which removes that one subscription. The callback never sees the event, and the return value
 * is not `ipcRenderer`, which must not leak into the page. The subscriptions of a channel share
 * one `ipcRenderer` listener (see `buildSubscriptionComponents`).
 */
export function buildSubscriptionChannel(ctx: PreloadContext, spec: t.ChannelSpec): ChannelEntry {
   const [i0, i1, i2] = ctx.indents;
   const read = ctx.isSerializedSpec(spec)
      ? `, (received: any[]) => readArguments('${spec.name}', received)`
      : "";
   const subscribe = (method: "on" | "once") =>
      [
         `${i1}${method}: (callback: Function) => {`,
         `${i2}return listenToChannel(${ctx.wireName(spec.name)}, callback, ${method === "once"}${read});`,
         `${i1}},`,
      ].join("\n");
   const methods = [subscribe("on"), subscribe("once")].join("\n");
   return { name: spec.name, property: `\n${i0}${spec.name}: {\n${methods}\n${i0}},` };
}

/**
 * `listenToChannel(channel, callback, once, read?)`, which `on` and `once` of the channels use. Each
 * subscription used to add an `ipcRenderer` listener of its own, and Node warns about more than
 * ten listeners of the same event (`MaxListenersExceededWarning`), which is no reason to refuse an
 * eleventh subscriber of a channel. So a channel has one `ipcRenderer` listener with the
 * subscribers behind it, which is added with the first subscriber and removed with the last.
 * - `read` turns the arguments of a message into the list that the callbacks get, once per
 *   message, or into nothing for a message that cannot be read. Then no callback runs, and a
 *   `once` subscriber stays;
 * - a subscriber is called in the order of subscription, and a `once` subscriber is removed
 *   before its callback runs, so that a message it causes cannot reach it again;
 * - a callback which unsubscribes any subscriber during a dispatch keeps that one from being
 *   called by it, and a subscriber which is added during a dispatch gets the next message;
 * - a callback which throws is logged and does not keep the others from running;
 * - the function it returns removes that one subscription, also when the callback is the same
 *   as another one, and does nothing when it is called again.
 */
export function buildSubscriptionComponents(indents: string[]): string {
   const [i1, i2, i3, i4, i5] = indents;
   return [
      "",
      "interface ChannelSubscriber {",
      `${i1}callback: Function;`,
      `${i1}once: boolean;`,
      "}",
      "",
      "interface ChannelSubscription {",
      `${i1}subscribers: ChannelSubscriber[];`,
      `${i1}listener: (_event: unknown, ...received: any[]) => void;`,
      "}",
      "",
      "const channelSubscriptions: { [channel: string]: ChannelSubscription | undefined } = { __proto__: null } as any;",
      "",
      "function listenToChannel(",
      `${i1}channel: string,`,
      `${i1}callback: Function,`,
      `${i1}once: boolean,`,
      `${i1}read?: (received: any[]) => any[] | undefined,`,
      "): () => void {",
      `${i1}let subscription = channelSubscriptions[channel];`,
      `${i1}if (!subscription) {`,
      `${i2}const subscribers: ChannelSubscriber[] = [];`,
      `${i2}const listener = (_event: unknown, ...received: any[]) => {`,
      `${i3}const args = read ? read(received) : received;`,
      `${i3}if (!args) {`,
      `${i4}return;`,
      `${i3}}`,
      `${i3}for (const next of subscribers.slice()) {`,
      `${i4}if (subscribers.indexOf(next) < 0) {`,
      `${i5}continue;`,
      `${i4}}`,
      `${i4}if (next.once) {`,
      `${i5}unlistenToChannel(channel, next);`,
      `${i4}}`,
      `${i4}try {`,
      `${i5}next.callback(...args);`,
      `${i4}} catch (error) {`,
      `${i5}console.error(error);`,
      `${i4}}`,
      `${i3}}`,
      `${i2}};`,
      `${i2}subscription = { subscribers, listener };`,
      `${i2}channelSubscriptions[channel] = subscription;`,
      `${i2}ipcRenderer.on(channel, listener);`,
      `${i1}}`,
      `${i1}const subscriber: ChannelSubscriber = { callback, once };`,
      `${i1}subscription.subscribers.push(subscriber);`,
      `${i1}return () => unlistenToChannel(channel, subscriber);`,
      "}",
      "",
      "function unlistenToChannel(channel: string, subscriber: ChannelSubscriber): void {",
      `${i1}const subscription = channelSubscriptions[channel];`,
      `${i1}const at = subscription ? subscription.subscribers.indexOf(subscriber) : -1;`,
      `${i1}if (!subscription || at < 0) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}subscription.subscribers.splice(at, 1);`,
      `${i1}if (subscription.subscribers.length === 0) {`,
      `${i2}delete channelSubscriptions[channel];`,
      `${i2}ipcRenderer.removeListener(channel, subscription.listener);`,
      `${i1}}`,
      "}",
   ].join("\n");
}
