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

import { settlePorts } from "./runtime-utils.js";

/** The default `channelPrefix`, which the generated bindings put in front of every wire name. */
export const WIRE_PREFIX = "autoipc:";

/** The wire name of a channel, with the channel prefix that the fixtures use. */
export const wire = (name: string) => `${WIRE_PREFIX}${name}`;

/** The wire name of the `close` message of a port channel. */
export const closeWire = (name: string) => `${wire(name)}:close`;

/** The wire name of the `disconnect` message of a port channel. */
export const disconnectWire = (name: string) => `${wire(name)}:disconnect`;

/** The envelope of a call or an answer that succeeded. */
export const ok = (value: unknown) => ({ ok: true, value });

/** The envelope of a call or an answer that failed. */
export const failed = (error: Record<string, unknown>) => ({ ok: false, error });

/** Lets the messages of ports, and the promises that they settle, arrive. */
export const settle = () => settlePorts(20);

/** Lets the promises that are settled by a message run. */
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
