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
import { buildUtilityPeer } from "./utility-peer.js";

/** The channels with a utility process, and the ones between a page and a utility process. */

/** The electron types that the helpers of the channels between a renderer and a utility process use. */
const BROKER_TYPES = ["BrowserWindow", "WebContents", "WebContentsView", "UtilityProcess"];

/**
 * The helpers of the channels between the main process and utility processes: the protocol
 * that `utility.ts` shares (see `buildUtilityPeer`), and one peer per `UtilityProcess`. The peer
 * listens for the messages of the child, and is closed when the child exits, which rejects the
 * pending calls with `IPC_UTILITY_EXITED`.
 *
 * The exit of a child cannot be read afterwards (`pid` is `undefined` before the spawn and after
 * the exit, and Electron drops what is posted to a child that is gone), so a child has to be
 * known from its fork: `forkUtility(...)` forks and attaches it at once, and `attachUtility(child)`
 * does the same for a child that was forked elsewhere, right after `utilityProcess.fork`. A
 * channel that is given a child which was never attached fails with
 * `IPC_UTILITY_NOT_ATTACHED`, since it would otherwise wait for a child that is gone (T86).
 * A child which calls the main process also needs its peer from the start. `serialized` is whether
 * any channel of the file goes through the serializer.
 */
export function buildUtilityHelpers(indents: string[], serialized: boolean): string {
   const [i1] = indents;
   return [
      // The brokered channels are not serialized in main, which keeps the serializer helpers out.
      buildUtilityPeer(indents, serialized),
      "const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();",
      "",
      "function getUtilityPeer(child: UtilityProcess, channel: string): UtilityPeer {",
      `${i1}const known = utilityPeers.get(child);`,
      `${i1}if (!known) {`,
      `${i1}${i1}throw new IpcUtilityError(channel, \`The utility process of the channel '\${channel}' was not attached. Fork it with forkUtility(), or call attachUtility(child) right after utilityProcess.fork()\`, 'IPC_UTILITY_NOT_ATTACHED');`,
      `${i1}}`,
      `${i1}return known;`,
      "}",
      "",
      "/** Rejects, as a promise does, when the child is not attached. */",
      "function callUtilityChild(child: UtilityProcess, channel: string, args: unknown[], timeoutMs?: number): Promise<unknown> {",
      `${i1}try {`,
      `${i1}${i1}return callUtilityPeer(getUtilityPeer(child, channel), channel, args, timeoutMs);`,
      `${i1}} catch (error) {`,
      `${i1}${i1}return Promise.reject(error);`,
      `${i1}}`,
      "}",
      "",
      "/**",
      " * Starts listening to a child that was forked elsewhere, so that its exit is seen and its calls are",
      " * answered. Call it right after `utilityProcess.fork`, before the child can exit. It does nothing for a",
      " * child that is attached already.",
      " */",
      "export function attachUtility(child: UtilityProcess): void {",
      `${i1}if (utilityPeers.has(child)) {`,
      `${i1}${i1}return;`,
      `${i1}}`,
      `${i1}const peer = createUtilityPeer((message) => child.postMessage(message));`,
      `${i1}utilityPeers.set(child, peer);`,
      `${i1}child.on('message', (message: unknown) => receiveUtilityMessage(peer, message));`,
      `${i1}child.once('exit', () => closeUtilityPeer(peer, 'The utility process exited'));`,
      "}",
      "",
      "/** `utilityProcess.fork`, which attaches the child at once, so that its exit is seen from the start. */",
      "export function forkUtility(...args: Parameters<typeof utilityProcess.fork>): UtilityProcess {",
      `${i1}const child = utilityProcess.fork(...args);`,
      `${i1}attachUtility(child);`,
      `${i1}return child;`,
      "}",
      "",
   ].join("\n");
}

/**
 * `invoke(child, ...args)` of a `callUtility` channel, `send(child, ...args)` of a
 * `notifyUtility` channel, `handle(child, callback)` of a `callMain` channel and
 * `on(child, callback)` and `once(child, callback)` of a `notifyMain` channel.
 */
export function buildUtilityChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   const [, i1, i2] = ctx.indents;
   // The names of the generated parameters must not shadow a parameter of the signature.
   const taken = ctx.collectIdentifiers([spec.signature.definition]);
   const childName = ctx.uniqueName("child", taken);
   const callbackName = ctx.uniqueName("callback", taken);
   const wire = ctx.wireName(spec.name);
   const peer = `getUtilityPeer(${childName}, ${wire})`;
   const childParam = `${childName}: UtilityProcess`;
   const typeParams = ctx.getTypeParams(spec.signature);
   const params = (...generated: string[]) =>
      [...generated, ctx.getOriginalParams(spec, false)].filter(Boolean).join(", ");
   const senderParams = ctx.getOriginalParams(spec, true);
   const rest = senderParams ? `[${senderParams}]` : "[]";
   const callback = `${callbackName}: ${spec.signature.definition}`;
   if (spec.direction === "MainToUtility") {
      if (spec.kind === "Broadcast") {
         return {
            name: spec.name,
            members: [
               `\n${i1}send: ${typeParams}(${params(childParam)}): void =>`,
               `\n${i2}sendUtilityPeer(${peer}, ${wire}, ${rest}),`,
            ],
         };
      }
      const returned = spec.signature.async
         ? spec.signature.returnType
         : `Promise<Awaited<${spec.signature.returnType}>>`;
      return {
         name: spec.name,
         members: [
            `\n${i1}invoke: ${typeParams}(${params(childParam)}): ${returned} =>`,
            `\n${i2}callUtilityChild(${childName}, ${wire}, ${rest}${ctx.getTimeoutArgument(spec)}) as ${returned},`,
         ],
      };
   }
   if (spec.kind === "Broadcast") {
      return {
         name: spec.name,
         members: [
            `\n${i1}on: (${childParam}, ${callback}) =>`,
            `\n${i2}addUtilityListener(${peer}, ${wire}, ${callbackName}, false),`,
            `\n${i1}once: (${childParam}, ${callback}) =>`,
            `\n${i2}addUtilityListener(${peer}, ${wire}, ${callbackName}, true),`,
         ],
      };
   }
   return {
      name: spec.name,
      members: [
         `\n${i1}handle: (${childParam}, ${callback}) =>`,
         `\n${i2}setUtilityHandler(${peer}, ${wire}, ${callbackName}),`,
      ],
   };
}

/**
 * `connectUtilityPort`, which `ipc.<name>.connect` of an `invokeUtility` or `streamUtility`
 * channel calls. The main process only pairs the page with the child, and sees none of the
 * traffic: it makes a `MessageChannelMain`, posts one port to the child as
 * `{ __ipc: 'port', channel, key }`, and the other to the page on the channel, with the same key.
 * It pairs once the page has loaded (see `watchPageLoad`), and again whenever a page loads, so a
 * page that reloads gets a fresh port. A failure of the first pairing is thrown to the caller, a
 * later one goes to `console.error`. The connection ends when `close` is called, when the child
 * exits and when the contents are destroyed, and the page is told through `<channel>:close`.
 * A channel has one connection per page: connecting again replaces the earlier one, so the two
 * cannot fight over the port of the page on a reload. The contents are resolved first, and a
 * setup step that fails undoes what was registered.
 */
export function buildBrokerHelpers(indents: string[]): string {
   const [i1, i2, i3] = indents;
   return [
      "",
      "let lastUtilityLinkId = 0;",
      "const utilityLinks = new Map<string, () => void>();",
      "",
      "function connectUtilityPort(",
      `${i1}channel: string,`,
      `${i1}child: UtilityProcess,`,
      `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
      "): { close: () => void } {",
      `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
      `${i1}// Contents that are destroyed already would never emit 'destroyed', which leaves the entry behind.`,
      `${i1}if (contents.isDestroyed()) {`,
      `${i2}throw new TypeError('Object has been destroyed');`,
      `${i1}}`,
      `${i1}// A child that exited would leave the page waiting for a port which never comes.`,
      `${i1}if (getUtilityPeer(child, channel).closed) {`,
      `${i2}throw new IpcUtilityError(channel, \`The utility process of the channel '\${channel}' is gone\`, 'IPC_UTILITY_EXITED');`,
      `${i1}}`,
      `${i1}const linkKey = \`\${channel}:\${contents.id}\`;`,
      `${i1}const key = \`\${++lastUtilityLinkId}:utility\`;`,
      `${i1}let closed = false;`,
      `${i1}const unwatch: (() => void)[] = [];`,
      `${i1}const pair = () => {`,
      `${i2}if (closed || contents.isDestroyed() || !watch.isLoaded()) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const { port1, port2 } = new MessageChannelMain();`,
      `${i2}try {`,
      `${i3}child.postMessage({ __ipc: 'port', channel, key }, [port1]);`,
      `${i3}contents.postMessage(channel, key, [port2]);`,
      `${i2}} catch (error) {`,
      `${i3}port1.close();`,
      `${i3}port2.close();`,
      `${i3}throw error;`,
      `${i2}}`,
      `${i1}};`,
      `${i1}const watch = watchPageLoad(contents, () => {`,
      `${i2}try {`,
      `${i3}pair();`,
      `${i2}} catch (error) {`,
      `${i3}console.error(error);`,
      `${i2}}`,
      `${i1}});`,
      `${i1}const close = () => {`,
      `${i2}if (closed) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}closed = true;`,
      `${i2}watch.dispose();`,
      `${i2}for (const stop of unwatch.splice(0)) {`,
      `${i3}stop();`,
      `${i2}}`,
      `${i2}if (utilityLinks.get(linkKey) === close) {`,
      `${i3}utilityLinks.delete(linkKey);`,
      `${i2}}`,
      `${i2}// Destroyed contents cannot be reached.`,
      `${i2}if (!contents.isDestroyed()) {`,
      `${i3}contents.send(\`\${channel}:close\`, key);`,
      `${i2}}`,
      `${i1}};`,
      `${i1}utilityLinks.get(linkKey)?.();`,
      `${i1}// A failure from here on undoes what was registered, since the caller never gets the handle.`,
      `${i1}try {`,
      `${i2}utilityLinks.set(linkKey, close);`,
      `${i2}unwatch.push(watchEvent(contents, 'destroyed', close), watchEvent(child, 'exit', close));`,
      `${i2}pair();`,
      `${i1}} catch (error) {`,
      `${i2}close();`,
      `${i2}throw error;`,
      `${i1}}`,
      `${i1}return { close };`,
      "}",
      "",
   ].join("\n");
}

/**
 * `ipc.<name>.connect(child, target)` of an `invokeUtility` or `streamUtility` channel, which
 * brokers the port between the child and the window, the view or the contents, and returns the
 * handle to close the connection. The calls themselves are made by the page, and handled by the
 * child, so the signature is not used here. Adds the electron imports that the helper uses.
 */
export function buildBrokeredChannel(
   ctx: MainContext,
   spec: t.ChannelSpec,
   values: Set<string>,
   types: Set<string>,
): ChannelEntry {
   const i1 = ctx.indents[1];
   values.add("MessageChannelMain");
   for (const type of BROKER_TYPES) {
      types.add(type);
   }
   const connector = [
      `\n${i1}connect: (child: UtilityProcess, target: BrowserWindow | WebContents | WebContentsView): { close: () => void } =>`,
      ` connectUtilityPort(${ctx.wireName(spec.name)}, child, target),`,
   ].join("");
   return { name: spec.name, members: [connector] };
}
