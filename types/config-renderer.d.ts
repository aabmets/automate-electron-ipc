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

import type { ArgumentsSchema, ChannelSignature } from "./channel-base.js";

/**
 * Options of the channels that a page takes part in.
 *
 * @property scopes - The scopes that the channel belongs to, such as `["settings", "editor"]`:
 *    lower case words, joined by dashes, up to 32 characters. Without `scopes` the channel is open
 *    to all windows. With them, only the windows of one of these scopes have it:
 *    - `ipcgen` generates a preload script and a `.d.ts` file for each scope, as
 *      `preload.<scope>.ts` and `window.<scope>.d.ts`, with the channels of the scope and the ones
 *      without `scopes`. The usual `preload.ts` and `window.d.ts` have only the channels without
 *      `scopes`, which is all of them in a schema that uses no scopes;
 *    - the generated `main.ts` exports `registerScope(window, scope)`, which puts the contents of
 *      a window, a view or contents into a scope. The main process rejects a call (`invoke`,
 *      `send` or `stream`) to a channel with `scopes` from contents that are not registered in one
 *      of them, with an `IpcForbiddenError`, and drops a `send` from them, like a sender that
 *      `allowedOrigins` does not allow. The `onRejected` hook of `configureIpc` hears of it.
 *      Contents that are in no scope can call the channels without `scopes` only.
 */
export interface ScopedConfig {
   scopes?: readonly string[];
}

/**
 * Options of `invoke` channels.
 *
 * @property allowedOrigins - The origins which may call the channel, such as
 *    `["app://.", "http://localhost:5173"]`. The generated main bindings compare each one for
 *    equality with `event.senderFrame.origin`, and reject calls from any other origin. An origin
 *    is a scheme, a host and an optional port, in lower case, without a path or a wildcard.
 * @property validate - A Standard Schema (zod, valibot, arktype, ...) of the argument tuple of
 *    the signature. It must be an identifier which the schema file imports as a value, such as
 *    `import { getUserArgs } from "./validators"`. The generated main bindings validate the
 *    arguments that the renderer sent before they call the handler, and reject the call with an
 *    `IpcValidationError` when they are invalid. The handler receives the validated output.
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of `ipc.<name>.invoke` is rejected with an `IpcTimeoutError`, which is
 *    the plain object `{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`. The handler is
 *    not stopped, and its late reply is dropped. `0` turns the timeout off for this channel,
 *    also when the `timeoutMs` of the `autoipc` config in `package.json` sets a default.
 */
export interface InvokeConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
   timeoutMs?: number;
}

/**
 * Options of `send` channels.
 *
 * @property allowedOrigins - The origins which may send to the channel. See `InvokeConfig`.
 * @property validate - A Standard Schema of the arguments. See `InvokeConfig`. A message with
 *    invalid arguments is dropped, and reported to the `onRejected` hook.
 */
export interface SendConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
}

/**
 * Options of `stream` channels.
 *
 * @property allowedOrigins - The origins which may start the stream. See `InvokeConfig`.
 * @property validate - A Standard Schema of the arguments. See `InvokeConfig`. A call with invalid
 *    arguments fails the stream with an `IpcValidationError`, before the handler runs.
 * @property highWaterMark - The most chunks that the generator may be ahead of the page: the main
 *    process sends this many chunks, and then stops pulling from the generator until the page has
 *    read some of them. A non-negative integer literal, or `Infinity` for no limit. The default is
 *    1024. The unit is the chunk, whatever its size, so lower it for large chunks. `0` makes the
 *    stream pull-based: the generator is asked for a chunk only while the page waits for one.
 */
export interface StreamConfig<S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
   highWaterMark?: number;
}

/**
 * Options of `port` channels.
 *
 * @property maxQueue - The most messages that `send` queues while there is no port to send to:
 *    before the page has loaded, after a port has closed, and, for the channel itself, while
 *    there is no connection yet. A non-negative integer literal, or `Infinity`. The default is
 *    1000. `0` queues nothing. A message that does not fit is handled by the overflow callback,
 *    which the page registers with `ipc.<name>.onOverflow`, and the oldest message is dropped by
 *    default. The first drop is logged with `console.warn`, and then every 100th.
 */
export interface PortConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   maxQueue?: number;
}

/**
 * Options of `mainPort` channels.
 *
 * @property maxQueue - The most messages that a send queue holds while there is no port, in the
 *    preload script and in the main process. See `PortConfig`. The main process registers its
 *    overflow callback with `configurePorts` and `connection.onOverflow`.
 */
export interface MainPortConfig<_S extends ChannelSignature = ChannelSignature>
   extends ScopedConfig {
   maxQueue?: number;
}

/**
 * Options of `ask` channels. See `ScopedConfig` for `scopes`: a window of another scope has no
 * responder for the question, so it never answers the main process.
 */
export interface AskConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {}

/**
 * Options of `emit` channels.
 *
 * @property trigger - Name of a BrowserWindow event. For a channel with a trigger, the main
 *    bindings also contain a `bind<Name>(browserWindow, provider)` callable. It registers one
 *    listener for the event, calls the provider each time the event fires and sends the
 *    arguments that the provider returns. It returns a function which removes the listener.
 */
export interface EmitConfig<_S extends ChannelSignature = ChannelSignature> extends ScopedConfig {
   trigger?:
      | "show"
      | "ready-to-show"
      | "app-command"
      | "blur"
      | "close"
      | "always-on-top-changed"
      | "closed"
      | "enter-full-screen"
      | "enter-html-full-screen"
      | "focus"
      | "hide"
      | "leave-full-screen"
      | "leave-html-full-screen"
      | "maximize"
      | "minimize"
      | "move"
      | "moved"
      | "new-window-for-tab"
      | "page-title-updated"
      | "persisted-state-restored"
      | "query-session-end"
      | "resize"
      | "resized"
      | "responsive"
      | "restore"
      | "rotate-gesture"
      | "session-end"
      | "sheet-begin"
      | "sheet-end"
      | "swipe"
      | "system-context-menu"
      | "unmaximize"
      | "unresponsive"
      | "will-move"
      | "will-resize";
}
