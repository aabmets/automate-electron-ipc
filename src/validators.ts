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

import path from "node:path";
import type * as t from "@types";
import type { Struct } from "superstruct";
import {
   assert,
   array,
   boolean,
   never,
   number,
   object,
   optional,
   refine,
   string,
} from "superstruct";

export function validateOptionalConfig(config: t.IPCOptionalConfig): void {
   const IPCOptionalConfigStruct = object({
      projectUsesNodeNext: boolean(),
      ipcDataDir: refine(string(), "relative", (value) => {
         const errMsg = "ipcDataDir must be relative to the project root";
         return path.isAbsolute(value) ? errMsg : true;
      }),
      codeIndent: refine(number(), "clamped", (value) => {
         const errMsg = "value cannot be less than 2 or greater than 4";
         return value >= 2 && value <= 4 ? true : errMsg;
      }),
   });
   assert(config, IPCOptionalConfigStruct);
}

export function getChannelSpecStruct(kind: t.ChannelKind): Struct<any, any> {
   const ListenersStruct = refine(string(), "format", (value) => {
      if (value.length < 5) {
         const msg = "Channel listener names must be at least 5 characters in length";
         return `'${value}'\n${msg}\n`;
      } else if (!/^on[A-Z]\w+/.test(value)) {
         const msg =
            "Channel listener names must begin with " +
            "lowercase 'on', followed by a capital letter";
         return `'${value}'\n${msg}\n`;
      }
      return true;
   });
   return object({
      name: refine(string(), "pascalcase", (value) => {
         if (value.length < 3) {
            return "Channel name must be at least 3 characters in length";
         } else if (value.toLowerCase().startsWith("on")) {
            return "Channel name must not begin with 'on'";
         } else if (/^(?![A-Z])/.test(value)) {
            return "Channel name must start with a capital letter";
         } else {
            return true;
         }
      }),
      kind: refine(string(), "choice", (value) => {
         const choices = ["Broadcast", "Unicast", "Port"];
         if (choices.includes(value)) {
            return true;
         } else {
            return `Channel kind must be one of '${choices}'`;
         }
      }),
      direction: refine(string(), "choice", (value) => {
         const choices = [];
         if (kind === "Broadcast") {
            choices.push("RendererToMain", "MainToRenderer");
         } else if (kind === "Unicast") {
            choices.push("RendererToMain");
         } else if (kind === "Port") {
            choices.push("RendererToRenderer");
         }
         return choices.includes(value)
            ? true
            : `Channel kind '${kind}' is not allowed when channel direction is '${value}'.`;
      }),
      signature: object({
         definition: string(),
         params: array(
            object({
               name: string(),
               type: string(),
               rest: boolean(),
               optional: boolean(),
            }),
         ),
         returnType: string(),
         customTypes: array(string()),
         async: boolean(),
      }),
      listeners: kind === "Broadcast" ? optional(array(ListenersStruct)) : optional(never()),
   });
}

export function validateChannelSpecs(specs: Partial<t.ChannelSpec>[]): t.ChannelSpec[] {
   const structMap = {
      BroadcastStruct: getChannelSpecStruct("Broadcast"),
      UnicastStruct: getChannelSpecStruct("Unicast"),
      PortStruct: getChannelSpecStruct("Port"),
   };
   const channelNames: string[] = [];
   for (const spec of specs) {
      if (spec?.kind === ("Broadcast" as t.ChannelKind)) {
         assert(spec, structMap.BroadcastStruct);
      } else if (spec?.kind === ("Unicast" as t.ChannelKind)) {
         assert(spec, structMap.UnicastStruct);
      } else if (spec?.kind === ("Port" as t.ChannelKind)) {
         assert(spec, structMap.PortStruct);
      }
      if (spec.name) {
         channelNames.push(spec.name);
      }
   }
   const ChannelNamesArrayStruct = refine(array() as any, "unique", (array: string[]) => {
      const seen = new Set<string>();
      for (const name of array) {
         if (seen.has(name)) {
            return `Channel name '${name}' is not unique across application.`;
         } else {
            seen.add(name);
         }
      }
      return true;
   });
   assert(channelNames, ChannelNamesArrayStruct);
   return specs as t.ChannelSpec[];
}

export default { validateOptionalConfig, getChannelSpecStruct, validateChannelSpecs };
