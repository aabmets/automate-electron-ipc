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
   UtilityCallConfig,
   UtilityConfig,
   UtilityPortConfig,
   UtilityStreamConfig,
} from "./config-utility.js";

/**
 * Request and response from the main process to a utility process (`utilityProcess.fork`), such
 * as a query to a SQLite database that the child owns. The main process calls
 * `ipc.<name>.invoke(child, ...args)`, where `child` is the `UtilityProcess`, and gets a promise
 * of the answer. The child registers its single handler with `ipc.<name>.handle(callback)` in the
 * generated `utility.ts`, which returns a function that removes it. The signature may return any
 * value, or a promise of it.
 *
 * The promise is rejected with an `IpcUtilityError` that carries the `name`, `message`, `code`
 * and `data` of what the handler threw. The library itself uses the codes `IPC_UTILITY_EXITED`
 * (the child exited, also while the call was pending, and any later call), `IPC_UTILITY_NOT_ATTACHED`
 * (the child was neither forked by the generated `forkUtility` nor passed to `attachUtility`),
 * `IPC_UTILITY_NO_HANDLER`,
 * `IPC_UTILITY_UNSENDABLE`, `IPC_UTILITY_INVALID_REPLY` and `IPC_UTILITY_TIMEOUT` (see `timeoutMs`
 * of `UtilityCallConfig`).
 *
 * @example
 * indexFile: callUtility<(path: string) => Promise<number>>()
 */
export function callUtility<S extends ChannelSignature = never>(
   config?: UtilityCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a utility process. No response is returned. The
 * signature must return `void` or `Promise<void>`. The main process calls
 * `ipc.<name>.send(child, ...args)`, and the child listens with `ipc.<name>.on(callback)` or
 * `once(callback)` in the generated `utility.ts`.
 *
 * @example
 * setLogLevel: notifyUtility<(level: "debug" | "info") => void>()
 */
export function notifyUtility<S extends ChannelSignature = never>(
   config?: UtilityConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from a utility process to the main process. The child calls
 * `ipc.<name>.invoke(...args)` in the generated `utility.ts` and gets a promise of the answer. The
 * main process registers a handler per child with `ipc.<name>.handle(child, callback)`, which
 * returns a function that removes it. The promise is rejected like that of `callUtility`, with
 * an `IpcUtilityError`.
 *
 * @example
 * getSetting: callMain<(key: string) => Promise<string | undefined>>()
 */
export function callMain<S extends ChannelSignature = never>(
   config?: UtilityCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from a utility process to the main process. The signature must return `void`
 * or `Promise<void>`. The child calls `ipc.<name>.send(...args)`, and the main process listens
 * per child with `ipc.<name>.on(child, callback)` or `once(child, callback)`.
 *
 * @example
 * progress: notifyMain<(done: number, total: number) => void>()
 */
export function notifyMain<S extends ChannelSignature = never>(
   config?: UtilityConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from a renderer process directly to a utility process, such as a database
 * query of a page, which would otherwise hop through the main process. The main process brokers a
 * `MessageChannelMain` between the window and the child with `ipc.<name>.connect(child, target)`
 * (`target` is a window, a view or contents), which returns `{ close }`. It pairs once the page
 * has loaded, and again on every load, so a page that reloads gets a fresh port. Connecting a
 * channel to a page again replaces the connection. It ends when `close` is called, when the child
 * exits and when the contents are destroyed.
 *
 * The page calls `ipc.<name>.invoke(...args)`. A call made before the main process has connected
 * waits for it. The child registers its single handler with `ipc.<name>.handle(callback)` in the
 * generated `utility.ts`, which returns a function that removes it. The signature may return any
 * value, or a promise of it.
 *
 * The promise is rejected with the plain object `{ name, message, code?, data? }` of what the
 * handler threw, as that of `invoke`. The library itself uses the codes `IPC_UTILITY_EXITED` (the
 * connection closed, also while the call was pending, and a call on a closed connection),
 * `IPC_UTILITY_NO_HANDLER`, `IPC_UTILITY_UNSENDABLE`, `IPC_UTILITY_INVALID_REPLY` and
 * `IPC_UTILITY_TIMEOUT` (see `timeoutMs` of `UtilityPortConfig`). The optional second type argument lists the error types, like that of `invoke`.
 *
 * @example
 * queryRows: invokeUtility<(sql: string) => Promise<Row[]>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * queryRows: invokeUtility() as (sql: string) => Promise<Row[]>
 */
export function invokeUtility<S extends ChannelSignature = never, E extends Error = never>(
   config?: UtilityPortConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * Stream of results from a utility process directly to a renderer process, with cancellation, over
 * the port that the main process brokers (see `invokeUtility`). The signature takes the arguments
 * of the call and returns an `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or
 * `AsyncGenerator<Chunk>`, and the handler in the child is an `async function*`, registered with
 * `ipc.<name>.handle(callback)` in `utility.ts`.
 *
 * The page calls `ipc.<name>.stream(...args)`, which returns the same async iterator with
 * `cancel()` as that of a `stream` channel. All the streams of a channel share the one port, so
 * the chunks of each carry the ID of its call. A stream that is open when the connection closes
 * fails with `IPC_UTILITY_EXITED`, and the generator in the child is stopped. The generator is
 * slowed down for a page that reads slowly, as for a `stream` channel: see `highWaterMark` of
 * `StreamConfig`. Each call has its own window.
 *
 * @example
 * scanRows: streamUtility<(table: string) => AsyncIterable<Row>, DatabaseError>()
 * // Alternative form, which does not check the config against the signature, and
 * // cannot declare error types:
 * scanRows: streamUtility() as (table: string) => AsyncIterable<Row>
 */
export function streamUtility<S extends ChannelSignature = never, E extends Error = never>(
   config?: UtilityStreamConfig<NoInfer<S>>,
): ChannelResult<S, E>;
