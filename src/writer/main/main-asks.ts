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

import { CLAMPED_TIMEOUT, errorClassLines, replyReaderLines } from "../generated-errors.js";
import type { MainContext } from "./main-bindings.js";

/** The helpers of the `ask` channels, which the questions to a service worker share. */

/** The `IpcAskError` and `IpcAskOptions` of the `ask` channels, and of the questions to a service worker. */
export function askErrorLines(indents: string[]): string[] {
   const [i1] = indents;
   return [
      ...errorClassLines(indents, "IpcAskError"),
      "",
      "export interface IpcAskOptions {",
      `${i1}/** Rejects with the code 'IPC_ASK_TIMEOUT' when the renderer or the worker has not answered by then. */`,
      `${i1}timeoutMs?: number;`,
      "}",
      "",
   ];
}

/** `readAskReply`, which reads the envelope of the answer to a question. */
export function readAskReplyLines(indents: string[]): string[] {
   return [
      ...replyReaderLines(indents, {
         fn: "readAskReply",
         errorClass: "IpcAskError",
         invalidCode: "IPC_ASK_INVALID_REPLY",
         invalidMessage: `\`The \${who} sent an unreadable reply\``,
         missingMessage: `\`The \${who} failed without a message\``,
         extraParam: "who = 'renderer'",
      }),
      "",
   ];
}

/**
 * The helpers of the `ask` channels. Electron has no invoke from the main process to a
 * renderer, so `askRenderer` sends the question with a correlation ID as its first argument,
 * and the preload script answers on the reply channel with the same ID and the envelope of the
 * `invoke` channels. Everything on the reply channel is untrusted, so a reply counts only when
 * the ID is pending for that reply channel, the sender is the contents (and frame) that was asked, and
 * the envelope has a known shape. Another renderer cannot answer for the one that was asked.
 *
 * The promise is settled once: by the answer, by the timeout, or because the contents are
 * destroyed, their renderer process is gone, or the document that was asked is replaced,
 * whichever comes first. The target is checked when the question is sent: contents that are
 * destroyed or crashed, and a frame that is destroyed or detached, are gone. Afterwards a reload
 * or navigation of the contents (`did-navigate`, which is not emitted for in-page navigations)
 * replaces the document that was asked. A frame has no event of its own, so for a frame the
 * `did-frame-navigate` of its contents counts: of that frame (by process and routing ID, or
 * because the frame is destroyed or detached by then), or of the main frame, which replaces
 * every frame below it. The commit is watched and not the start, so the old document can still
 * answer while a navigation is pending, and a navigation that `beforeunload` cancels changes
 * nothing. The events are watched through `watchEvent`, so any number of pending questions
 * adds one listener of each event to the contents, and not one of its own each (T87).
 * `IpcAskError` carries the `name`, `message`, `code` and `data` of an error of the responder,
 * and the code `IPC_ASK_TIMEOUT`, `IPC_ASK_DESTROYED`, `IPC_ASK_NO_HANDLER` or
 * `IPC_ASK_INVALID_REPLY` for the failures of the library itself.
 */
export function buildAskHelpers(ctx: MainContext): string {
   const [i1, i2, i3, i4] = ctx.indents;
   return [
      "",
      ...askErrorLines(ctx.indents),
      "interface PendingAsk {",
      `${i1}reply: string;`,
      `${i1}contents: WebContents | undefined;`,
      `${i1}frame: WebFrameMain | undefined;`,
      `${i1}answer: (envelope: unknown) => void;`,
      "}",
      "",
      "const pendingAsks: { [id: string]: unknown } = { __proto__: null };",
      "const askReplyListeners: { [reply: string]: unknown } = { __proto__: null };",
      "let lastAskId = 0;",
      "",
      "function isSameFrame(a: WebFrameMain, b: WebFrameMain): boolean {",
      `${i1}try {`,
      `${i2}return a === b || (a.processId === b.processId && a.routingId === b.routingId);`,
      `${i1}} catch {`,
      `${i2}return false;`,
      `${i1}}`,
      "}",
      "",
      "function listenForAskReplies(reply: string): void {",
      `${i1}if (askReplyListeners[reply]) {`,
      `${i2}return;`,
      `${i1}}`,
      `${i1}askReplyListeners[reply] = true;`,
      `${i1}electronIpcMain.on(reply, (event: IpcMainEvent, id: unknown, envelope: unknown) => {`,
      `${i2}const pending = typeof id === 'number' ? (pendingAsks[id] as PendingAsk | undefined) : undefined;`,
      `${i2}if (!pending || pending.reply !== reply) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}let allowed = false;`,
      `${i2}try {`,
      `${i3}const frame = event.senderFrame;`,
      `${i3}allowed =`,
      `${i4}(!pending.contents || event.sender === pending.contents) &&`,
      `${i4}(!pending.frame || (frame != null && isSameFrame(frame, pending.frame)));`,
      `${i2}} catch {`,
      `${i3}allowed = false;`,
      `${i2}}`,
      `${i2}if (allowed) {`,
      `${i3}pending.answer(envelope);`,
      `${i2}}`,
      `${i1}});`,
      "}",
      "",
      ...readAskReplyLines(ctx.indents),
      "function askRenderer(",
      `${i1}channel: string,`,
      `${i1}wire: string,`,
      `${i1}reply: string,`,
      `${i1}target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,`,
      `${i1}args: unknown[],`,
      `${i1}options?: IpcAskOptions,`,
      "): Promise<unknown> {",
      `${i1}return new Promise<unknown>((resolve, reject) => {`,
      `${i2}const timeoutMs = options?.timeoutMs;`,
      `${i2}if (timeoutMs !== undefined && !(typeof timeoutMs === 'number' && timeoutMs >= 0)) {`,
      `${i3}throw new TypeError('timeoutMs must be a number which is not negative');`,
      `${i2}}`,
      `${i2}const destroyed = new IpcAskError(`,
      `${i3}channel,`,
      `${i3}\`The renderer that was asked on the channel '\${channel}' is gone\`,`,
      `${i3}'IPC_ASK_DESTROYED',`,
      `${i2});`,
      `${i2}// The webContents of a destroyed BrowserWindow throws when it is read, so the target is`,
      `${i2}// resolved under the same guard as the checks for a target that is gone.`,
      `${i2}let destination: WebContents | WebFrameMain | undefined;`,
      `${i2}let frame: WebFrameMain | undefined;`,
      `${i2}let contents: WebContents | undefined;`,
      `${i2}let frameIds: { processId: number; routingId: number } | undefined;`,
      `${i2}let isGone = false;`,
      `${i2}try {`,
      `${i3}isGone = !!(target as { isDestroyed?: () => boolean }).isDestroyed?.();`,
      `${i3}if (!isGone) {`,
      `${i4}destination = resolveSendTarget(target);`,
      `${i4}frame = 'getURL' in destination ? undefined : destination;`,
      `${i4}contents = 'getURL' in destination ? destination : electronWebContents.fromFrame(destination);`,
      `${i4}isGone =`,
      `${i4}${i1}!!(contents && (contents.isDestroyed() || contents.isCrashed())) ||`,
      `${i4}${i1}!!(frame && (frame.isDestroyed?.() || frame.detached));`,
      `${i4}if (frame) {`,
      `${i4}${i1}frameIds = { processId: frame.processId, routingId: frame.routingId };`,
      `${i4}}`,
      `${i3}}`,
      `${i2}} catch {`,
      `${i3}isGone = true;`,
      `${i2}}`,
      `${i2}if (isGone || !destination) {`,
      `${i3}reject(destroyed);`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}listenForAskReplies(reply);`,
      `${i2}const id = ++lastAskId;`,
      `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
      `${i2}let stopWatching = (): void => undefined;`,
      `${i2}let onGone = (): void => undefined;`,
      `${i2}let onFrameNavigate = (..._details: unknown[]): void => undefined;`,
      `${i2}const finish = (settle: () => void): void => {`,
      `${i3}clearTimeout(timer);`,
      `${i3}delete pendingAsks[id];`,
      `${i3}stopWatching();`,
      `${i3}settle();`,
      `${i2}};`,
      `${i2}onGone = () => finish(() => reject(destroyed));`,
      `${i2}// A navigation of the frame that was asked, or of the main frame, replaces its document.`,
      `${i2}onFrameNavigate = (...details: unknown[]): void => {`,
      `${i3}let replaced = details[4] === true;`,
      `${i3}try {`,
      `${i4}replaced =`,
      `${i4}${i1}replaced ||`,
      `${i4}${i1}(frameIds !== undefined &&`,
      `${i4}${i2}details[5] === frameIds.processId &&`,
      `${i4}${i2}details[6] === frameIds.routingId) ||`,
      `${i4}${i1}!!(frame && (frame.isDestroyed?.() || frame.detached));`,
      `${i3}} catch {`,
      `${i4}replaced = true;`,
      `${i3}}`,
      `${i3}if (replaced) {`,
      `${i4}onGone();`,
      `${i3}}`,
      `${i2}};`,
      `${i2}const pending: PendingAsk = {`,
      `${i3}reply,`,
      `${i3}contents,`,
      `${i3}frame,`,
      `${i3}answer: (envelope) => {`,
      ...(ctx.usesSerializer
         ? [
              `${i4}let outcome = readAskReply(channel, envelope);`,
              `${i4}if (!('error' in outcome)) {`,
              `${i4}${i1}try {`,
              `${i4}${i2}outcome = { value: decodeValue(channel, outcome.value) };`,
              `${i4}${i1}} catch (cause) {`,
              `${i4}${i2}outcome = { error: new IpcAskError(channel, \`The answer cannot be read: \${cause instanceof Error ? cause.message : String(cause)}\`, 'IPC_ASK_INVALID_REPLY') };`,
              `${i4}${i1}}`,
              `${i4}}`,
              `${i4}const settled = outcome;`,
           ]
         : [`${i4}const settled = readAskReply(channel, envelope);`]),
      `${i4}finish(() => ('error' in settled ? reject(settled.error) : resolve(settled.value)));`,
      `${i3}},`,
      `${i2}};`,
      `${i2}pendingAsks[id] = pending;`,
      `${i2}if (contents) {`,
      `${i3}const asked = contents;`,
      `${i3}const stops = [`,
      `${i4}watchEvent(asked, 'destroyed', onGone),`,
      `${i4}watchEvent(asked, 'render-process-gone', onGone),`,
      `${i4}frame ? watchEvent(asked, 'did-frame-navigate', onFrameNavigate) : watchEvent(asked, 'did-navigate', onGone),`,
      `${i3}];`,
      `${i3}stopWatching = () => {`,
      `${i4}for (const stop of stops) {`,
      `${i4}${i1}stop();`,
      `${i4}}`,
      `${i3}};`,
      `${i2}}`,
      `${i2}if (timeoutMs !== undefined && timeoutMs !== Infinity) {`,
      `${i3}const error = new IpcAskError(`,
      `${i4}channel,`,
      `${i4}\`The renderer did not answer the channel '\${channel}' within \${timeoutMs} ms\`,`,
      `${i4}'IPC_ASK_TIMEOUT',`,
      `${i3});`,
      `${i3}timer = setTimeout(() => finish(() => reject(error)), ${CLAMPED_TIMEOUT});`,
      `${i2}}`,
      `${i2}try {`,
      `${i3}destination.send(wire, id, ${ctx.usesSerializer ? "encodeValue(channel, args)" : "...args"});`,
      `${i2}} catch (error) {`,
      `${i3}finish(() => reject(error));`,
      `${i2}}`,
      `${i1}});`,
      "}",
      "",
   ].join("\n");
}
