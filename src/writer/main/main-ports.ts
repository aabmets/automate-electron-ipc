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

function getPortTypes(spec: t.ChannelSpec): string[] {
   const types = ["BrowserWindow", "IpcMainEvent", "WebContents"];
   return spec.direction === "MainToRenderer"
      ? [...types, "WebContentsView", "MessagePortMain"]
      : types;
}

/** Builds a port channel, and adds the electron imports that its helpers use. */
export function buildPort(
   ctx: MainContext,
   spec: t.ChannelSpec,
   values: Set<string>,
   types: Set<string>,
): ChannelEntry {
   values.add("MessageChannelMain");
   for (const type of getPortTypes(spec)) {
      types.add(type);
   }
   return spec.direction === "MainToRenderer"
      ? buildMainPortChannel(ctx, spec)
      : buildPortChannel(ctx, spec);
}

/**
 * The registry of the ends of connections, which both kinds of port channel use. Every end of a
 * connection has a key: the message that carries its port, and the one that closes it. A page
 * tells the keys apart, so it can hold any number of connections of a channel, and replaces the
 * port of the one that is paired again. A page ends a connection through `<channel>:disconnect`,
 * which is honoured only from the contents that hold that end. The main process no longer holds
 * the ports that it has transferred, so it tells the pages through `<channel>:close` when a
 * connection ends.
 */
export function buildPortRegistry(indents: string[]): string {
   const [i1, i2, i3] = indents;
   return [
      "",
      "let lastPortConnectionId = 0;",
      "const portEnds = new Map<string, { contents: WebContents; close: () => void }>();",
      "const portDisconnectChannels = new Set<string>();",
      "",
      "function listenForPortDisconnects(channel: string): void {",
      `${i1}if (portDisconnectChannels.has(channel)) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}portDisconnectChannels.add(channel);`,
      `${i1}electronIpcMain.on(\`\${channel}:disconnect\`, (event: IpcMainEvent, key: unknown) => {`,
      `${i2}const end = typeof key === 'string' ? portEnds.get(key) : undefined;`,
      `${i2}if (end && !end.contents.isDestroyed() && end.contents === event.sender) {`,
      `${i3}end.close();`,
      `${i2}}`,
      `${i1}});`,
      "}",
      "",
   ].join("\n");
}

/**
 * `connectPorts`, which `ipc.<name>.connect` calls. A pair of ports is made only when both
 * windows have loaded their page (see `watchPageLoad`), since a port that is posted earlier
 * arrives before the preload script listens for it. It is made right away if both have, and
 * again whenever a page loads, so a window that is shown late and a page that reloads get a fresh port, and
 * the other window replaces its end. The connection ends when it is closed and when either
 * window is destroyed. Both windows are resolved before anything is registered, so a destroyed
 * window makes `connect` throw Electron's own error and leaves nothing behind, and a setup step
 * that fails later undoes what was registered.
 */
export function buildPortHelpers(indents: string[]): string {
   const [i1, i2, i3, i4] = indents;
   return [
      "",
      "function connectPorts(channel: string, winA: BrowserWindow, winB: BrowserWindow): { close: () => void } {",
      `${i1}const id = ++lastPortConnectionId;`,
      `${i1}// Both windows are resolved before anything is registered: the getter of a destroyed window throws.`,
      `${i1}const ends = [`,
      `${i2}{ key: \`\${id}:a\`, win: winA, contents: winA.webContents },`,
      `${i2}{ key: \`\${id}:b\`, win: winB, contents: winB.webContents },`,
      `${i1}];`,
      `${i1}const watched = winA === winB ? [ends[0]] : ends;`,
      `${i1}let closed = false;`,
      `${i1}const watches = new Map<BrowserWindow, PageLoadWatch>();`,
      `${i1}const unwatchClosed: (() => void)[] = [];`,
      `${i1}const isReady = (win: BrowserWindow) => !win.isDestroyed() && !!watches.get(win)?.isLoaded();`,
      `${i1}const pair = () => {`,
      `${i2}if (closed || !isReady(winA) || !isReady(winB)) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}const { port1, port2 } = new MessageChannelMain();`,
      `${i2}ends[0].contents.postMessage(channel, ends[0].key, [port1]);`,
      `${i2}ends[1].contents.postMessage(channel, ends[1].key, [port2]);`,
      `${i1}};`,
      `${i1}const close = () => {`,
      `${i2}if (closed) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}closed = true;`,
      `${i2}for (const end of watched) {`,
      `${i3}watches.get(end.win)?.dispose();`,
      `${i2}}`,
      `${i2}for (const unwatch of unwatchClosed.splice(0)) {`,
      `${i3}unwatch();`,
      `${i2}}`,
      `${i2}for (const end of ends) {`,
      `${i3}portEnds.delete(end.key);`,
      `${i3}if (!end.win.isDestroyed()) {`,
      `${i4}end.contents.send(\`\${channel}:close\`, end.key);`,
      `${i3}}`,
      `${i2}}`,
      `${i1}};`,
      `${i1}// A failure from here on undoes what was registered, since the caller never gets the handle.`,
      `${i1}try {`,
      `${i2}for (const end of ends) {`,
      `${i3}portEnds.set(end.key, { contents: end.contents, close });`,
      `${i2}}`,
      `${i2}listenForPortDisconnects(channel);`,
      `${i2}for (const end of watched) {`,
      `${i3}unwatchClosed.push(watchEvent(end.win, 'closed', close));`,
      `${i3}watches.set(end.win, watchPageLoad(end.contents, pair));`,
      `${i2}}`,
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

/** `ipc.<name>.connect(winA, winB)`, which pairs the windows and returns a handle to close the connection. */
function buildPortChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   const i1 = ctx.indents[1];
   const connector = [
      `\n${i1}connect: (winA: BrowserWindow, winB: BrowserWindow) =>`,
      ` connectPorts(${ctx.wireName(spec.name)}, winA, winB),`,
   ].join("");
   return { name: spec.name, members: [connector] };
}

/**
 * `ipc.<name>.connect(target)` of a `mainPort` channel, which pairs the contents of the window,
 * the view or the contents and returns the connection. The messages are typed with the signature
 * in both directions: `send` takes its parameters, and the callback of `on` is the signature.
 */
function buildMainPortChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   const i1 = ctx.indents[1];
   const typeParams = ctx.getTypeParams(spec.signature);
   const send = `${typeParams}(${ctx.getOriginalParams(spec, false)}) => void`;
   const message = `Parameters<${spec.signature.definition}>`;
   const overflow = `(queue: ${message}[], message: ${message}, info: PortOverflowInfo) => ${message}[]`;
   const connection = [
      `{ send: ${send};`,
      ` on: (callback: ${spec.signature.definition}) => () => void;`,
      " onReady: (callback: () => void) => () => void;",
      " onClose: (callback: () => void) => () => void;",
      ` onOverflow: (callback: (${overflow}) | undefined) => () => void;`,
      " close: () => void }",
   ].join("");
   const connector = [
      `\n${i1}connect: (target: BrowserWindow | WebContents | WebContentsView): ${connection} =>`,
      ` connectMainPort(${ctx.wireName(spec.name)}, '${spec.name}', ${ctx.getMaxQueue(spec)}, target),`,
   ].join("");
   return { name: spec.name, members: [connector] };
}
