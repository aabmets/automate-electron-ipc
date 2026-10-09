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
import shared from "@testutils/writer/writer-utils.js";
import type * as t from "@types";

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
export const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;
export const all = [invokeFromWorker, sendFromWorker, askWorker, emitToWorker];

export const render = async (
   channels: shared.SimpleChannel[],
   config: Partial<t.IPCResolvedConfig> = {},
) => {
   const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
      channelPrefix: "autoipc:",
      ...config,
   });
   await obj.write(false);
   return (await fsp.readFile(obj.getTargetFilePath())).toString();
};
