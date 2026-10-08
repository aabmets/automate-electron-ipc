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

import type * as api from "../types/index.js";
import logger from "./logger.js";

function verb(): never {
   logger.cannotExecuteChannels();
   return undefined as never;
}

export const defineChannels: typeof api.defineChannels = (channels) => {
   logger.cannotExecuteChannels();
   return channels;
};
export const invoke: typeof api.invoke = verb;
export const send: typeof api.send = verb;
export const emit: typeof api.emit = verb;
export const ask: typeof api.ask = verb;
export const stream: typeof api.stream = verb;
export const port: typeof api.port = verb;
export const mainPort: typeof api.mainPort = verb;
