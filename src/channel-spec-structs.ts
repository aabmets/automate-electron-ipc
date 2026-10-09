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
import type { Struct } from "superstruct";
import {
   array,
   assert,
   boolean,
   never,
   number,
   object,
   optional,
   refine,
   string,
} from "superstruct";
import {
   AllowedOriginsStruct,
   ScopesStruct,
   TriggerStruct,
   TypeRefStruct,
   ValidatorRefStruct,
} from "./option-structs.js";

/** A channel name is emitted as an object key, so any ECMAScript identifier name is valid. */
const CHANNEL_NAME = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*$/u;

/** What differs between the kinds of channel spec: the options that they accept. */
interface SpecStructFlags {
   /** A `trigger` option (`emit`). */
   triggerable?: boolean;
   /** `allowedOrigins` and `validate` (a call of a page to the main process). */
   restrictable?: boolean;
   /** An `ask`, which goes from the main process to a page. */
   asking?: boolean;
   /** A `maxQueue` option (port channels). */
   bounded?: boolean;
   /** A `stream`, which has a chunk type. */
   streaming?: boolean;
   /** A channel between the main process and a utility process. */
   utility?: boolean;
   /** A channel between a page and a utility process. */
   brokered?: boolean;
   /** A `scopes` option (the channels that a page takes part in). */
   scoped?: boolean;
   /** A channel that a service worker calls in the main process. */
   workerCall?: boolean;
   /** A channel from the main process to a service worker. */
   workerNotify?: boolean;
}

function getChannelSpecStruct(kind: t.ChannelKind, flags: SpecStructFlags = {}): Struct<any, any> {
   const {
      triggerable = false,
      restrictable = false,
      asking = false,
      bounded = false,
      streaming = false,
      utility = false,
      brokered = false,
      scoped = false,
      workerCall = false,
      workerNotify = false,
   } = flags;
   return object({
      name: refine(string(), "identifier", (value) =>
         CHANNEL_NAME.test(value) ? true : `Channel name '${value}' is not a plain identifier`,
      ),
      kind: refine(string(), "choice", (value) => {
         const choices = ["Broadcast", "Unicast", "Port", "Stream"];
         if (choices.includes(value)) {
            return true;
         } else {
            return `Channel kind must be one of: ['${choices.join("', '")}']`;
         }
      }),
      direction: refine(string(), "choice", (value) => {
         const choices = [];
         if (brokered) {
            choices.push("RendererToUtility");
         } else if (workerCall) {
            choices.push("ServiceWorkerToMain");
         } else if (workerNotify) {
            choices.push("MainToServiceWorker");
         } else if (utility) {
            choices.push("MainToUtility", "UtilityToMain");
         } else if (kind === "Broadcast") {
            choices.push("RendererToMain", "MainToRenderer");
         } else if (kind === "Unicast") {
            choices.push(asking ? "MainToRenderer" : "RendererToMain");
         } else if (kind === "Port") {
            choices.push("RendererToRenderer", "MainToRenderer");
         } else if (kind === "Stream") {
            choices.push("RendererToMain");
         }
         return choices.includes(value)
            ? true
            : `Channel kind '${kind}' is not allowed when channel direction is '${value}'.`;
      }),
      signature: object({
         definition: string(),
         paramsStart: number(),
         params: array(
            object({
               name: string(),
               type: string(),
               typeStart: optional(number()),
               rest: boolean(),
               optional: boolean(),
            }),
         ),
         returnType: string(),
         returnStart: optional(number()),
         returnsVoid: optional(boolean()),
         chunkType: streaming ? string() : optional(never()),
         chunkStart: streaming ? optional(number()) : optional(never()),
         customTypes: array(string()),
         async: boolean(),
         typeRefs: optional(array(TypeRefStruct)),
         cloneIssues: optional(
            array(
               object({
                  level: refine(string(), "level", (value) =>
                     ["error", "warning"].includes(value) ? true : "level must be error or warning",
                  ),
                  where: string(),
                  type: string(),
                  reason: string(),
                  via: optional(string()),
               }),
            ),
         ),
      }),
      errors:
         (kind === "Unicast" && !asking && !utility && !workerNotify) || streaming
            ? optional(
                 object({
                    definition: string(),
                    customTypes: array(string()),
                    typeRefs: optional(array(TypeRefStruct)),
                 }),
              )
            : optional(never()),
      trigger: triggerable ? optional(TriggerStruct) : optional(never()),
      allowedOrigins:
         restrictable || workerCall ? optional(AllowedOriginsStruct) : optional(never()),
      validate: restrictable || workerCall ? optional(ValidatorRefStruct) : optional(never()),
      scopes: scoped ? optional(ScopesStruct) : optional(never()),
      maxQueue: bounded ? optional(number()) : optional(never()),
      highWaterMark: streaming ? optional(number()) : optional(never()),
      timeoutMs:
         (kind === "Unicast" || (kind === "Stream" && brokered)) && !asking && !workerNotify
            ? optional(number())
            : optional(never()),
   });
}

export function validateChannelSpecWithStruct(spec: Partial<t.ChannelSpec>): void {
   const structMap = {
      TriggerableBroadcastStruct: getChannelSpecStruct("Broadcast", {
         triggerable: true,
         scoped: true,
      }),
      BroadcastStruct: getChannelSpecStruct("Broadcast", { restrictable: true, scoped: true }),
      UnicastStruct: getChannelSpecStruct("Unicast", { restrictable: true, scoped: true }),
      AskStruct: getChannelSpecStruct("Unicast", { asking: true, scoped: true }),
      PortStruct: getChannelSpecStruct("Port", { bounded: true, scoped: true }),
      StreamStruct: getChannelSpecStruct("Stream", {
         restrictable: true,
         streaming: true,
         scoped: true,
      }),
      UtilityBroadcastStruct: getChannelSpecStruct("Broadcast", { utility: true }),
      UtilityUnicastStruct: getChannelSpecStruct("Unicast", { utility: true }),
      WorkerCallBroadcastStruct: getChannelSpecStruct("Broadcast", { workerCall: true }),
      WorkerCallUnicastStruct: getChannelSpecStruct("Unicast", { workerCall: true }),
      WorkerNotifyBroadcastStruct: getChannelSpecStruct("Broadcast", { workerNotify: true }),
      WorkerNotifyUnicastStruct: getChannelSpecStruct("Unicast", { workerNotify: true }),
      BrokeredUnicastStruct: getChannelSpecStruct("Unicast", { brokered: true, scoped: true }),
      BrokeredStreamStruct: getChannelSpecStruct("Stream", {
         streaming: true,
         brokered: true,
         scoped: true,
      }),
   };
   // The channels of the utility processes and of the service workers have a struct of their own
   // for each direction. A spec of another direction is checked against its kind, and rejected
   // there when the kind is not allowed with the direction.
   const byDirection: Record<string, Partial<Record<string, Struct<any, any>>>> = {
      RendererToUtility: {
         Unicast: structMap.BrokeredUnicastStruct,
         Stream: structMap.BrokeredStreamStruct,
      },
      MainToUtility: {
         Broadcast: structMap.UtilityBroadcastStruct,
         Unicast: structMap.UtilityUnicastStruct,
      },
      UtilityToMain: {
         Broadcast: structMap.UtilityBroadcastStruct,
         Unicast: structMap.UtilityUnicastStruct,
      },
      ServiceWorkerToMain: {
         Broadcast: structMap.WorkerCallBroadcastStruct,
         Unicast: structMap.WorkerCallUnicastStruct,
      },
      MainToServiceWorker: {
         Broadcast: structMap.WorkerNotifyBroadcastStruct,
         Unicast: structMap.WorkerNotifyUnicastStruct,
      },
   };
   const direction = spec?.direction as string | undefined;
   const known = direction === undefined ? undefined : byDirection[direction]?.[spec?.kind ?? ""];
   if (known) {
      assert(spec, known);
   } else if (spec?.kind === ("Broadcast" as t.ChannelKind)) {
      if (spec?.direction === ("MainToRenderer" as t.ChannelDirection)) {
         assert(spec, structMap.TriggerableBroadcastStruct);
      } else {
         assert(spec, structMap.BroadcastStruct);
      }
   } else if (spec?.kind === ("Unicast" as t.ChannelKind)) {
      // An `ask` goes from the main process to a renderer, an `invoke` the other way.
      assert(
         spec,
         spec?.direction === ("MainToRenderer" as t.ChannelDirection)
            ? structMap.AskStruct
            : structMap.UnicastStruct,
      );
   } else if (spec?.kind === ("Stream" as t.ChannelKind)) {
      assert(spec, structMap.StreamStruct);
   } else {
      assert(spec, structMap.PortStruct);
   }
}
