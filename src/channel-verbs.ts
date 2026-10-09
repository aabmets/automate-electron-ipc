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

export interface VerbInfo {
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   options: string[];
   /** Whether the verb takes the error types as a second type argument. */
   errors?: boolean;
}

export const VERBS = new Map<string, VerbInfo>([
   [
      "invoke",
      {
         kind: "Unicast",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "send",
      {
         kind: "Broadcast",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "scopes"],
      },
   ],
   ["emit", { kind: "Broadcast", direction: "MainToRenderer", options: ["trigger", "scopes"] }],
   ["ask", { kind: "Unicast", direction: "MainToRenderer", options: ["scopes"] }],
   [
      "stream",
      {
         kind: "Stream",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "highWaterMark", "scopes"],
         errors: true,
      },
   ],
   ["port", { kind: "Port", direction: "RendererToRenderer", options: ["maxQueue", "scopes"] }],
   ["mainPort", { kind: "Port", direction: "MainToRenderer", options: ["maxQueue", "scopes"] }],
   ["callUtility", { kind: "Unicast", direction: "MainToUtility", options: ["timeoutMs"] }],
   ["notifyUtility", { kind: "Broadcast", direction: "MainToUtility", options: [] }],
   ["callMain", { kind: "Unicast", direction: "UtilityToMain", options: ["timeoutMs"] }],
   ["notifyMain", { kind: "Broadcast", direction: "UtilityToMain", options: [] }],
   [
      "invokeUtility",
      {
         kind: "Unicast",
         direction: "RendererToUtility",
         options: ["timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "streamUtility",
      {
         kind: "Stream",
         direction: "RendererToUtility",
         options: ["highWaterMark", "timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "invokeFromWorker",
      {
         kind: "Unicast",
         direction: "ServiceWorkerToMain",
         options: ["allowedOrigins", "validate", "timeoutMs"],
         errors: true,
      },
   ],
   [
      "sendFromWorker",
      {
         kind: "Broadcast",
         direction: "ServiceWorkerToMain",
         options: ["allowedOrigins", "validate"],
      },
   ],
   ["askWorker", { kind: "Unicast", direction: "MainToServiceWorker", options: [] }],
   ["emitToWorker", { kind: "Broadcast", direction: "MainToServiceWorker", options: [] }],
]);

/** The options whose value is an array of string literals. The others are string literals. */
export const ARRAY_OPTIONS = new Set(["allowedOrigins", "scopes"]);
