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
import {
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestServiceWorkerPreloadWriter,
   VitestUtilityBindingsWriter,
} from "./test-writers.js";
import { type SimpleChannel } from "./writer-utils.js";

export const IMPORT =
   'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "superjson";';

export const invoke: SimpleChannel = {
   name: "getIt",
   kind: "Unicast",
   direction: "RendererToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const send: SimpleChannel = {
   name: "sendIt",
   kind: "Broadcast",
   direction: "RendererToMain",
   params: ["at: Date"],
};
export const emit: SimpleChannel = {
   name: "emitIt",
   kind: "Broadcast",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
export const ask: SimpleChannel = {
   name: "askIt",
   kind: "Unicast",
   direction: "MainToRenderer",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};
export const stream: SimpleChannel = {
   name: "streamIt",
   kind: "Stream",
   direction: "RendererToMain",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
export const port: SimpleChannel = {
   name: "portIt",
   kind: "Port",
   direction: "RendererToRenderer",
   params: ["at: Date"],
};
export const mainPort: SimpleChannel = {
   name: "mainPortIt",
   kind: "Port",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
export const utility: SimpleChannel = {
   name: "utilityIt",
   kind: "Unicast",
   direction: "MainToUtility",
   params: ["at: Date"],
   returnType: "Promise<void>",
};
export const utilityNotify: SimpleChannel = {
   name: "utilityNotify",
   kind: "Broadcast",
   direction: "MainToUtility",
   params: ["at: Date"],
};
export const callMain: SimpleChannel = {
   name: "callMain",
   kind: "Unicast",
   direction: "UtilityToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const notifyMain: SimpleChannel = {
   name: "notifyMain",
   kind: "Broadcast",
   direction: "UtilityToMain",
   params: ["at: Date"],
};
export const brokeredCall: SimpleChannel = {
   name: "brokeredCall",
   kind: "Unicast",
   direction: "RendererToUtility",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const brokeredStream: SimpleChannel = {
   name: "brokeredStream",
   kind: "Stream",
   direction: "RendererToUtility",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
export const worker: SimpleChannel = {
   name: "workerIt",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const workerSend: SimpleChannel = {
   name: "workerSend",
   kind: "Broadcast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "void",
};
export const workerEmit: SimpleChannel = {
   name: "workerEmit",
   kind: "Broadcast",
   direction: "MainToServiceWorker",
   params: ["at: Date"],
   returnType: "void",
};
export const workerAsk: SimpleChannel = {
   name: "workerAsk",
   kind: "Unicast",
   direction: "MainToServiceWorker",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};

export const config = { serializer: "superjson", channelPrefix: "autoipc:" };
export const main = (channels: SimpleChannel[], extra: Partial<t.IPCResolvedConfig> = {}) =>
   renderWith(VitestMainBindingsWriter, channels, { ...config, ...extra });
export const preload = (channels: SimpleChannel[], extra: Partial<t.IPCResolvedConfig> = {}) =>
   renderWith(VitestPreloadBindingsWriter, channels, { ...config, ...extra });
export const utilityFile = (channels: SimpleChannel[], extra: Partial<t.IPCResolvedConfig> = {}) =>
   renderWith(VitestUtilityBindingsWriter, channels, { ...config, ...extra });
export const workerPreload = (
   channels: SimpleChannel[],
   extra: Partial<t.IPCResolvedConfig> = {},
) => renderWith(VitestServiceWorkerPreloadWriter, channels, { ...config, ...extra });
