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
import { renderWith } from "./render-utils.js";
import { VitestMainBindingsWriter } from "./test-writers.js";
import { type SimpleChannel } from "./writer-utils.js";

export const invokeFromWorker = {
   name: "getToken",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
} as const;
export const sendFromWorker = {
   name: "syncDone",
   kind: "Broadcast",
   direction: "ServiceWorkerToMain",
} as const;
export const askWorker = {
   name: "flush",
   kind: "Unicast",
   direction: "MainToServiceWorker",
} as const;
export const emitToWorker = {
   name: "configChanged",
   kind: "Broadcast",
   direction: "MainToServiceWorker",
} as const;
export const all = [invokeFromWorker, sendFromWorker, askWorker, emitToWorker];

export const render = (channels: SimpleChannel[], config: Partial<t.IPCResolvedConfig> = {}) =>
   renderWith(VitestMainBindingsWriter, channels, {
      channelPrefix: "autoipc:",
      ...config,
   });
