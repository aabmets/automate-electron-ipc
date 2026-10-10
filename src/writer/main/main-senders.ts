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

export function getSenderTypes(spec: t.ChannelSpec): string[] {
   const types = ["BrowserWindow", "WebContents", "WebContentsView", "WebFrameMain"];
   // The listener of the replies of an `ask` channel takes the event of `ipcMain.on`.
   return spec.kind === "Unicast" ? [...types, "IpcMainEvent"] : types;
}

/**
 * The helpers of the channels from the main process to a renderer. `resolveSendTarget` takes
 * the receiver out of what `send` or `invoke` is given: a window or a view has contents as
 * `webContents`, while a `WebContents` and a `WebFrameMain` receive the message themselves.
 * The `emit` channels also get these two. `broadcastMessage` sends to every contents that is not destroyed, optionally only to those
 * that `filter` accepts. Destroyed contents are skipped, since sending to them throws.
 * `sendToSenderFrame` replies to the frame that sent the event. Electron clears `senderFrame`
 * once the frame navigates or is destroyed, so it is read first, and a missing, destroyed or
 * detached frame is skipped, which the return value reports.
 */
export function buildSenderHelpers(indents: string[], emits: boolean): string {
   const [i1, i2, i3] = indents;
   const resolve = [
      "",
      "function resolveSendTarget(",
      `${i1}target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,`,
      "): WebContents | WebFrameMain {",
      `${i1}return 'webContents' in target ? target.webContents : target;`,
      "}",
      "",
   ];
   if (!emits) {
      return resolve.join("\n");
   }
   return [
      ...resolve,
      "function broadcastMessage(",
      `${i1}channel: string,`,
      `${i1}args: unknown[],`,
      `${i1}filter?: (contents: WebContents) => boolean,`,
      "): void {",
      `${i1}for (const contents of electronWebContents.getAllWebContents()) {`,
      `${i2}if (!contents.isDestroyed() && (!filter || filter(contents))) {`,
      `${i3}contents.send(channel, ...args);`,
      `${i2}}`,
      `${i1}}`,
      "}",
      "",
      "function sendToSenderFrame(",
      `${i1}event: { readonly senderFrame: WebFrameMain | null },`,
      `${i1}channel: string,`,
      `${i1}args: unknown[],`,
      "): boolean {",
      `${i1}let frame: WebFrameMain | null = null;`,
      `${i1}try {`,
      `${i2}frame = event.senderFrame;`,
      `${i2}if (frame && (frame.isDestroyed?.() || frame.detached)) {`,
      `${i3}frame = null;`,
      `${i2}}`,
      `${i1}} catch {`,
      `${i2}frame = null;`,
      `${i1}}`,
      `${i1}if (!frame) {`,
      `${i2}return false;`,
      `${i1}}`,
      `${i1}frame.send(channel, ...args);`,
      `${i1}return true;`,
      "}",
      "",
   ].join("\n");
}

/**
 * `ipc.<name>.send(target, ...args)` to one window, view, contents or frame,
 * `sendToSender(event, ...args)` to the frame that sent the event, `broadcast(...args)` to
 * all contents, `broadcastTo(filter, ...args)` to those that the filter accepts, and
 * `ipc.<name>.bind(window, provider)` with a trigger. The filter comes first, since the
 * signature may end in optional or rest parameters, which would swallow an options argument.
 */
export function buildMainToRendererChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   if (spec.kind === "Unicast") {
      return buildAskChannel(ctx, spec);
   }
   const [, i1, i2] = ctx.indents;
   // The names of the generated parameters must not shadow a parameter of the signature.
   const taken = ctx.collectIdentifiers([spec.signature.definition]);
   const targetName = ctx.uniqueName("target", taken);
   const filterName = ctx.uniqueName("filter", taken);
   const eventName = ctx.uniqueName("event", taken);
   const senderParams = ctx.getOriginalParams(spec, true);
   const wire = ctx.wireName(spec.name);
   // A serialized message is one argument, the list of the arguments, as the serializer made it.
   const serialized = ctx.isSerializedSpec(spec);
   const wired = serialized ? `encodeValue('${spec.name}', [${senderParams}])` : senderParams;
   const sender = `resolveSendTarget(${targetName}).send(${wire}, ${wired})`;
   const ipcParams = ctx.getOriginalParams(spec, false);
   const typeParams = ctx.getTypeParams(spec.signature);
   const targetType = "BrowserWindow | WebContents | WebContentsView | WebFrameMain";
   const ipcSignature = `${typeParams}(${targetName}: ${targetType}, ${ipcParams})`;
   const filterType = `(contents: WebContents) => boolean`;
   const eventType = "{ readonly senderFrame: WebFrameMain | null }";
   const rest = serialized ? `[${wired}]` : senderParams ? `[${senderParams}]` : "[]";
   const members = [
      `\n${i1}send: ${ipcSignature} =>`,
      `\n${i2}${sender},`,
      `\n${i1}sendToSender: ${typeParams}(${eventName}: ${eventType}, ${ipcParams}) =>`,
      `\n${i2}sendToSenderFrame(${eventName}, ${wire}, ${rest}),`,
      `\n${i1}broadcast: ${typeParams}(${ipcParams}) =>`,
      `\n${i2}broadcastMessage(${wire}, ${rest}),`,
      `\n${i1}broadcastTo: ${typeParams}(${filterName}: ${filterType}, ${ipcParams}) =>`,
      `\n${i2}broadcastMessage(${wire}, ${rest}, ${filterName}),`,
   ];
   if (spec.trigger) {
      members.push(`\n${buildTriggerBinder(ctx, spec)}`);
   }
   return { name: spec.name, members };
}

/**
 * `ipc.<name>.invoke(target, ...args)` asks one window, view, contents or frame, and
 * `ipc.<name>.invokeWith(target, { timeoutMs }, ...args)` does so with a timeout. The options
 * come before the arguments, since a signature that ends in optional or rest parameters would
 * swallow trailing options. Both return a promise of what the responder in the renderer returns.
 */
function buildAskChannel(ctx: MainContext, spec: t.ChannelSpec): ChannelEntry {
   const [, i1, i2] = ctx.indents;
   // The names of the generated parameters must not shadow a parameter of the signature.
   const taken = ctx.collectIdentifiers([spec.signature.definition]);
   const targetName = ctx.uniqueName("target", taken);
   const optionsName = ctx.uniqueName("options", taken);
   const senderParams = ctx.getOriginalParams(spec, true);
   const ipcParams = ctx.getOriginalParams(spec, false);
   const typeParams = ctx.getTypeParams(spec.signature);
   const targetType = "BrowserWindow | WebContents | WebContentsView | WebFrameMain";
   const returned = spec.signature.async
      ? spec.signature.returnType
      : `Promise<Awaited<${spec.signature.returnType}>>`;
   const channel = `'${spec.name}'`;
   const rest = senderParams ? `[${senderParams}]` : "[]";
   const params = (generated: string[]) => [...generated, ipcParams].filter(Boolean).join(", ");
   const ask = (options: string) =>
      `askRenderer(${channel}, ${ctx.wireName(spec.name)}, ${ctx.wireName(spec.name, ":reply")}, ${targetName}, ${rest}${options}) as ${returned}`;
   const members = [
      `\n${i1}invoke: ${typeParams}(${params([`${targetName}: ${targetType}`])}): ${returned} =>`,
      `\n${i2}${ask("")},`,
      `\n${i1}invokeWith: ${typeParams}(${params([`${targetName}: ${targetType}`, `${optionsName}: IpcAskOptions`])}): ${returned} =>`,
      `\n${i2}${ask(`, ${optionsName}`)},`,
   ];
   return { name: spec.name, members };
}

/**
 * Builds `bind(browserWindow, provider)`, which registers one listener for the trigger
 * event, evaluates the provider each time the event fires and returns a disposer.
 * An error of the provider or of the send skips that send and goes to `onError`,
 * or to `console.error` without it, so that it is never an unhandled rejection.
 */
function buildTriggerBinder(ctx: MainContext, spec: t.ChannelSpec): string {
   const [, i1, i2, i3, i4, i5] = ctx.indents;
   const args = `[${ctx.getOriginalParams(spec, false)}]`;
   const provider = `provider: () => ${args} | Promise<${args}>`;
   const onError = "onError?: (error: unknown) => void";
   const event = JSON.stringify(spec.trigger);
   const typeParams = ctx.getTypeParams(spec.signature);
   return [
      `${i1}bind: ${typeParams}(browserWindow: BrowserWindow, ${provider}, ${onError}) => {`,
      `${i2}const listener = async () => {`,
      `${i3}try {`,
      `${i4}const args = await provider();`,
      `${i4}if (!browserWindow.isDestroyed()) {`,
      `${i5}browserWindow.webContents.send(${ctx.wireName(spec.name)}, ${
         ctx.isSerializedSpec(spec) ? `encodeValue('${spec.name}', args)` : "...args"
      });`,
      `${i4}}`,
      `${i3}} catch (error) {`,
      `${i4}(onError ?? console.error)(error);`,
      `${i3}}`,
      `${i2}};`,
      `${i2}browserWindow.on(${event}, listener);`,
      `${i2}return () => {`,
      `${i3}browserWindow.off(${event}, listener);`,
      `${i2}};`,
      `${i1}},`,
   ].join("\n");
}
