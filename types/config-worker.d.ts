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
 * Options of `sendFromWorker` channels, and the base of those of `invokeFromWorker`.
 *
 * @property allowedOrigins - The origins which may use the channel, such as `["app://."]`. The
 *    generated main bindings compare each one for equality with the origin of the scope of the
 *    service worker, and reject calls from any other origin. An origin is a scheme, a host and an
 *    optional port, in lower case, without a path or a wildcard. The events of a service worker
 *    have no `senderFrame`, so this and the `validateSender` hook of `configureServiceWorkerIpc`,
 *    which sees `versionId` and `serviceWorker.scope`, are the sender checks.
 * @property validate - A Standard Schema of the argument tuple of the signature, as for `invoke`
 *    (see `InvokeConfig`). What a worker sends is as untrusted as what a page sends. The generated
 *    main bindings validate the arguments after the sender check, and before the callback runs,
 *    which gets the validated output. An invalid message is dropped. The `onRejected` hook of
 *    `configureServiceWorkerIpc` hears of it, with an `IpcValidationError`.
 */
export interface WorkerCallConfig<S extends ChannelSignature = ChannelSignature> {
   allowedOrigins?: readonly string[];
   validate?: ArgumentsSchema<S>;
}

/**
 * Options of `invokeFromWorker` channels. See `WorkerCallConfig` for `allowedOrigins` and
 * `validate`. A call with invalid arguments is rejected with an `IpcValidationError`, which
 * reaches the worker as a plain object, like the errors of the handler.
 *
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of `ipc.<name>.invoke` in the worker is rejected with an `IpcTimeoutError`,
 *    which is the plain object `{ name: "IpcTimeoutError", message, code: "IPC_TIMEOUT" }`. The
 *    preload script of a worker has no timers, so the main process times the call, from its arrival
 *    over the schema and the handler. The handler is not stopped, and its late reply is dropped. With
 *    `rawErrors`, the worker gets the error of Electron instead. `0` turns the timeout off for this
 *    channel, also when the `timeoutMs` of the `autoipc` config in `package.json` sets a default.
 */
export interface WorkerInvokeConfig<S extends ChannelSignature = ChannelSignature>
   extends WorkerCallConfig<S> {
   timeoutMs?: number;
}

/**
 * Options of the channels from the main process to a service worker (`askWorker` and
 * `emitToWorker`). There are none yet.
 */
export interface WorkerNotifyConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}
