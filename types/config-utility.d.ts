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

import type { ChannelSignature } from "./channel-base.js";
import type { ScopedConfig } from "./config-renderer.js";

/**
 * Options of the channels between the main process and a utility process
 * (`callUtility`, `notifyUtility`, `callMain` and `notifyMain`). See `UtilityCallConfig` for the
 * options of the two that wait for an answer. `notifyUtility` and `notifyMain` have none.
 */
export interface UtilityConfig<_S extends ChannelSignature = ChannelSignature> {
   [option: string]: never;
}

/**
 * Options of `callUtility` and `callMain` channels.
 *
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of the call is rejected with an `IpcUtilityError` with the code
 *    `IPC_UTILITY_TIMEOUT`. The handler is not stopped, and its late reply is dropped. `0` turns the
 *    timeout off for this channel, also when the `timeoutMs` of the `autoipc` config in
 *    `package.json` sets a default.
 */
export interface UtilityCallConfig<_S extends ChannelSignature = ChannelSignature> {
   timeoutMs?: number;
}

/**
 * Options of the channels between a renderer and a utility process (`invokeUtility` and
 * `streamUtility`). See `ScopedConfig` for `scopes`, which decides which windows have the channel in
 * their API. The main process pairs a window with a child in `connect`, whatever the scope is.
 *
 * @property timeoutMs - A non-negative integer literal. After this many milliseconds without a
 *    reply, the promise of `ipc.<name>.invoke` is rejected with the plain object
 *    `{ name: "IpcUtilityError", message, code: "IPC_UTILITY_TIMEOUT" }`. The timer starts when the
 *    page makes the call, so it covers the wait for the connection too. The handler in the child
 *    is not stopped, and its late reply is dropped. `0` turns the timeout off for this channel, also
 *    when the `timeoutMs` of the `autoipc` config in `package.json` sets a default. On a
 *    `streamUtility` channel, see `UtilityStreamConfig`.
 */
export interface UtilityPortConfig<_S extends ChannelSignature = ChannelSignature>
   extends ScopedConfig {
   timeoutMs?: number;
}

/**
 * Options of `streamUtility` channels. See `UtilityPortConfig`.
 *
 * @property highWaterMark - The most chunks that the generator in the child may be ahead of the
 *    page. See `StreamConfig`. The window is per call, though all the streams of a channel share
 *    one port.
 * @property timeoutMs - A non-negative integer literal. A stream that has not sent its first
 *    chunk, its end or an error after this many milliseconds is cancelled in the child, and the
 *    read of the page is rejected with the plain object `{ name: "IpcUtilityError", message, code:
 *    "IPC_UTILITY_TIMEOUT" }`. A stream that has begun is not cut short, since a slow reader holds
 *    the generator back on purpose. Unlike for the calls, the `timeoutMs` of the config in
 *    `package.json` is not a default for it: `0`, the default, waits for ever.
 */
export interface UtilityStreamConfig<S extends ChannelSignature = ChannelSignature>
   extends UtilityPortConfig<S> {
   highWaterMark?: number;
}
