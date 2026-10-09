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
import type { WorkerCallConfig, WorkerInvokeConfig, WorkerNotifyConfig } from "./config-worker.js";

/**
 * Request and response from a service worker to the main process, for a worker that needs the
 * main process for what it cannot do itself (Electron 35 or later, experimental). The signature may
 * return any value, or a promise of it.
 *
 * The worker calls `ipc.<name>.invoke(...args)` from the generated `service-worker-preload.ts`,
 * which `session.registerPreloadScript({ type: "service-worker", filePath })` runs in the worker. The
 * main process registers one handler per session with `ipc.<name>.handle(session, callback)`, which
 * returns a function that removes it. The callback gets an `IpcMainServiceWorkerInvokeEvent`
 * first, which has `serviceWorker`, `versionId` and no `senderFrame`.
 *
 * An error that the handler throws reaches the worker as the plain object
 * `{ name, message, code?, data? }`, like that of `invoke`. The optional second type argument lists
 * the error types, like that of `invoke`.
 *
 * @example
 * getToken: invokeFromWorker<(scope: string) => Promise<string>>()
 */
export function invokeFromWorker<S extends ChannelSignature = never, E extends Error = never>(
   config?: WorkerInvokeConfig<NoInfer<S>>,
): ChannelResult<S, E>;

/**
 * One-way message from a service worker to the main process. The signature must return `void` or
 * `Promise<void>`. The worker calls `ipc.<name>.send(...args)` in the generated
 * `service-worker-preload.ts`, and the main process listens per session with
 * `ipc.<name>.on(session, callback)` or `once(session, callback)`.
 *
 * @example
 * reportSync: sendFromWorker<(done: number) => void>()
 */
export function sendFromWorker<S extends ChannelSignature = never>(
   config?: WorkerCallConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * Request and response from the main process to a service worker: the main process asks and awaits
 * the answer. Electron has no invoke in this direction, so the generated code sends the request with
 * a correlation ID and the worker answers on a reply channel, like an `ask` channel.
 *
 * The main process calls `ipc.<name>.invoke(worker, ...args)`, or
 * `ipc.<name>.invokeWith(worker, { timeoutMs }, ...args)`, where `worker` is a `ServiceWorkerMain`
 * of a session that `attachServiceWorkers(session)` knows. It gets a promise of the answer, which is
 * rejected with an `IpcAskError` when the worker stops, when the timeout passes, when the worker has
 * no responder and when the responder throws. The worker registers its single responder with
 * `ipc.<name>.handle(callback)`, which returns a function that removes it.
 *
 * @example
 * flushQueue: askWorker<(force: boolean) => number>()
 */
export function askWorker<S extends ChannelSignature = never>(
   config?: WorkerNotifyConfig<NoInfer<S>>,
): ChannelResult<S>;

/**
 * One-way message from the main process to a service worker. The signature must return `void` or
 * `Promise<void>`. The main process calls `ipc.<name>.send(worker, ...args)` to one
 * `ServiceWorkerMain`, or `ipc.<name>.broadcast(session, ...args)` to all the workers of a session
 * that are running. The worker listens with `ipc.<name>.on(callback)` or `once(callback)`.
 *
 * @example
 * configChanged: emitToWorker<(key: string) => void>()
 */
export function emitToWorker<S extends ChannelSignature = never>(
   config?: WorkerNotifyConfig<NoInfer<S>>,
): ChannelResult<S>;
