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

import fsp from "node:fs/promises";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";

export const IMPORT =
   'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "superjson";';

export const invoke: shared.SimpleChannel = {
   name: "getIt",
   kind: "Unicast",
   direction: "RendererToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const send: shared.SimpleChannel = {
   name: "sendIt",
   kind: "Broadcast",
   direction: "RendererToMain",
   params: ["at: Date"],
};
export const emit: shared.SimpleChannel = {
   name: "emitIt",
   kind: "Broadcast",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
export const ask: shared.SimpleChannel = {
   name: "askIt",
   kind: "Unicast",
   direction: "MainToRenderer",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};
export const stream: shared.SimpleChannel = {
   name: "streamIt",
   kind: "Stream",
   direction: "RendererToMain",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
export const port: shared.SimpleChannel = {
   name: "portIt",
   kind: "Port",
   direction: "RendererToRenderer",
   params: ["at: Date"],
};
export const mainPort: shared.SimpleChannel = {
   name: "mainPortIt",
   kind: "Port",
   direction: "MainToRenderer",
   params: ["at: Date"],
};
export const utility: shared.SimpleChannel = {
   name: "utilityIt",
   kind: "Unicast",
   direction: "MainToUtility",
   params: ["at: Date"],
   returnType: "Promise<void>",
};
export const utilityNotify: shared.SimpleChannel = {
   name: "utilityNotify",
   kind: "Broadcast",
   direction: "MainToUtility",
   params: ["at: Date"],
};
export const callMain: shared.SimpleChannel = {
   name: "callMain",
   kind: "Unicast",
   direction: "UtilityToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const brokeredCall: shared.SimpleChannel = {
   name: "brokeredCall",
   kind: "Unicast",
   direction: "RendererToUtility",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const brokeredStream: shared.SimpleChannel = {
   name: "brokeredStream",
   kind: "Stream",
   direction: "RendererToUtility",
   params: ["since: Date"],
   returnType: "AsyncIterable<Date>",
};
export const worker: shared.SimpleChannel = {
   name: "workerIt",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "Promise<Date>",
};
export const workerSend: shared.SimpleChannel = {
   name: "workerSend",
   kind: "Broadcast",
   direction: "ServiceWorkerToMain",
   params: ["at: Date"],
   returnType: "void",
};
export const workerEmit: shared.SimpleChannel = {
   name: "workerEmit",
   kind: "Broadcast",
   direction: "MainToServiceWorker",
   params: ["at: Date"],
   returnType: "void",
};
export const workerAsk: shared.SimpleChannel = {
   name: "workerAsk",
   kind: "Unicast",
   direction: "MainToServiceWorker",
   params: ["zone: string"],
   returnType: "Promise<Date>",
};

export const config = { serializer: "superjson", channelPrefix: "autoipc:" };
export const main = async (
   channels: shared.SimpleChannel[],
   extra: Partial<t.IPCResolvedConfig> = {},
) => {
   const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
      ...config,
      ...extra,
   });
   await obj.write(false);
   return (await fsp.readFile(obj.getTargetFilePath())).toString();
};
export const preload = async (
   channels: shared.SimpleChannel[],
   extra: Partial<t.IPCResolvedConfig> = {},
) => {
   const obj = new shared.VitestPreloadBindingsWriter(shared.buildFileSpecs(...channels), {
      ...config,
      ...extra,
   });
   await obj.write(false);
   return (await fsp.readFile(obj.getTargetFilePath())).toString();
};
export const utilityFile = async (
   channels: shared.SimpleChannel[],
   extra: Partial<t.IPCResolvedConfig> = {},
) => {
   const obj = new shared.VitestUtilityBindingsWriter(shared.buildFileSpecs(...channels), {
      ...config,
      ...extra,
   });
   await obj.write(false);
   return (await fsp.readFile(obj.getTargetFilePath())).toString();
};
export const workerPreload = async (
   channels: shared.SimpleChannel[],
   extra: Partial<t.IPCResolvedConfig> = {},
) => {
   const obj = new shared.VitestServiceWorkerPreloadWriter(shared.buildFileSpecs(...channels), {
      ...config,
      ...extra,
   });
   await obj.write(false);
   return (await fsp.readFile(obj.getTargetFilePath())).toString();
};
