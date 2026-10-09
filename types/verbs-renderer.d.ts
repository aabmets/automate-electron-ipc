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

import type { ChannelResult, ChannelSignature } from "./channel-base.js";
import type {
   AskConfig,
   EmitConfig,
   InvokeConfig,
   MainPortConfig,
   PortConfig,
   SendConfig,
   StreamConfig,
} from "./config-renderer.js";

/**
 * Declares the channels of the application. The key of each property is the channel name.
 * The map must be exported from the schema file, either as the default export
 * or as a named `const` export, and a file may contain only one `defineChannels` call.
 *
 * @example
 * export default defineChannels({
 *    getUser: invoke<(id: number) => Promise<User>>(),
 * });
 */
export function defineChannels<T extends Record<string, unknown>>(channels: T): T;

/**
 * Request and response from a renderer process to the main process.
 * The main process handles the call and its result is returned to the invoker.
 * The signature may return any value, or a promise of it.
 *
 * An error that the handler throws reaches the renderer as a plain object
 * `{ name, message, code?, data? }`, which rejects the promise of `ipc.<name>.invoke`.
 * The optional second type argument lists the error types that the handler may throw. It
 * documents them in the generated `types.ts`. It needs the generic form of the signature.
 *
 * @example
 * getUser: invoke<(id: number) => Promise<User>, NotFoundError | AuthError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * getUser: invoke() as (id: number) => Promise<User>
 */
export function invoke<S extends ChannelSignature = never, E extends Error = never>(
   config?: InvokeConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * One-way message from a renderer process to the main process.
 * No response is returned. The signature must return `void` or `Promise<void>`.
 *
 * @example
 * echoUserName: send<(userName: string) => void>()
 */
export function send<S extends ChannelSignature = never>(
   config?: SendConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a renderer process.
 * The signature must return `void` or `Promise<void>`.
 * If a trigger is given, then a `bind<Name>` callable is generated in addition to the sender,
 * which sends automatically when that BrowserWindow event fires.
 *
 * @example
 * progress: emit<(n: number) => void>({ trigger: "focus" })
 */
export function emit<S extends ChannelSignature = never>(
   config?: EmitConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from the main process to a renderer process: the main process asks and
 * awaits the answer, such as "are there unsaved changes?" on `close`. Electron has no invoke
 * in this direction, so the generated code sends the request with a correlation ID and the
 * renderer answers on a reply channel.
 *
 * The main process calls `ipc.<name>.invoke(target, ...args)`, or
 * `ipc.<name>.invokeWith(target, { timeoutMs }, ...args)`, and gets a promise of the answer.
 * It rejects with an `IpcAskError` when the target is destroyed, when the timeout passes, when
 * the renderer has no handler, and when the handler throws. The renderer registers its single
 * responder with `ipc.<name>.handle(callback)`, which returns a function that removes it.
 * The signature may return any value, or a promise of it.
 *
 * @example
 * hasUnsavedChanges: ask<(documentId: number) => boolean>()
 */
export function ask<S extends ChannelSignature = never>(
   config?: AskConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Stream of results from the main process to a renderer process, with cancellation, for downloads,
 * exports, long jobs and token streams. The signature takes the arguments of the call and returns
 * an `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk>`, and the
 * handler in the main process is an `async function*`. Each call gets a message channel of its own,
 * which carries the chunks in order, then the end or the error of the stream.
 *
 * The page calls `ipc.<name>.stream(...args)`, which returns an async iterator with `cancel()`:
 * `for await (const chunk of ipc.<name>.stream(...))` reads the chunks, and `break`, `return()`
 * and `cancel()` stop the stream and call `return()` on the generator in the main process. An
 * `AbortSignal` cannot cross `contextBridge`, so a page that has one calls
 * `signal.addEventListener("abort", () => stream.cancel())`. A failure of the stream, such as an
 * error of the generator, rejects the read of the page with the plain object
 * `{ name, message, code?, data? }` of an `invoke` error. The optional second type argument lists
 * the error types, like that of `invoke`.
 *
 * The generator is slowed down for a page that reads slowly. The page grants the main process a
 * window of `highWaterMark` unread chunks, the main process stops pulling from the generator when
 * the window is used up, and the page grants more as it reads. `cancel()` and errors work while
 * the generator is paused.
 *
 * @example
 * exportRows: stream<(table: string) => AsyncIterable<Row>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * exportRows: stream() as (table: string) => AsyncIterable<Row>
 */
export function stream<S extends ChannelSignature = never, E extends Error = never>(
   config?: StreamConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * Two-way channel between two renderer processes over a single message port.
 * The signature must return `void` or `Promise<void>`.
 *
 * @example
 * chat: port<(msg: string) => void>()
 */
export function port<S extends ChannelSignature = never>(
   config?: PortConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Two-way channel between the main process and a renderer process over a single message port,
 * for high-frequency data such as log tailing, audio meters or progress, which would otherwise
 * pay the overhead of `ipcMain` for every message. The signature must return `void` or
 * `Promise<void>`, and types the messages in both directions.
 *
 * The main process connects a window, a view or contents with `ipc.<name>.connect(target)`, and
 * gets a connection with `send`, `on`, `onReady`, `onClose` and `close`. The renderer has the API
 * of a `port` channel: `send`, `on`, `onReady`, `onClose` and `onConnection`.
 *
 * @example
 * logTail: mainPort<(line: string) => void>()
 */
export function mainPort<S extends ChannelSignature = never>(
   config?: MainPortConfig<NoInfer<S>>,
): ChannelResult<S>;
