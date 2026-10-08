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
   array,
   assert,
   boolean,
   never,
   nullable,
   number,
   object,
   optional,
   refine,
   string,
} from "superstruct";
import utils from "./utils.js";

export function validateOptionalConfig(config: t.IPCOptionalConfig): void {
   const IPCOptionalConfigStruct = object({
      projectUsesNodeNext: boolean(),
      ipcDataDir: refine(string(), "relative", (value) => {
         const errMsg = "ipcDataDir must be relative to the project root";
         return path.isAbsolute(value) ? errMsg : true;
      }),
      codeIndent: refine(number(), "clamped", (value) => {
         if (!Number.isInteger(value)) {
            return "value must be an integer";
         }
         const errMsg = "value cannot be less than 2 or greater than 4";
         return value >= 2 && value <= 4 ? true : errMsg;
      }),
   });
   assert(config, IPCOptionalConfigStruct);
}

function getChannelSpecStruct(kind: t.ChannelKind, triggerable = false): Struct<any, any> {
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
      name: refine(string(), "camelcase", (value) => {
         if (value.length < 3) {
            return "Channel name must be at least 3 characters in length";
         } else if (/^on[A-Z]/.test(value)) {
            return "Channel name must not begin with 'on'";
         } else if (/^(?![a-z])/.test(value)) {
            return "Channel name must start with a lowercase letter";
         } else {
            return true;
         }
      }),
      kind: refine(string(), "choice", (value) => {
         const choices = ["Broadcast", "Unicast", "Port"];
         if (choices.includes(value)) {
            return true;
         } else {
            return `Channel kind must be one of: ['${choices.join("', '")}']`;
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
      trigger: triggerable ? optional(string()) : optional(never()),
   });
}

export function validateChannelSpecWithStruct(spec: Partial<t.ChannelSpec>): void {
   const structMap = {
      TriggerableBroadcastStruct: getChannelSpecStruct("Broadcast", true),
      BroadcastStruct: getChannelSpecStruct("Broadcast"),
      UnicastStruct: getChannelSpecStruct("Unicast"),
      PortStruct: getChannelSpecStruct("Port"),
   };
   if (spec?.kind === ("Broadcast" as t.ChannelKind)) {
      if (spec?.direction === ("MainToRenderer" as t.ChannelDirection)) {
         assert(spec, structMap.TriggerableBroadcastStruct);
      } else {
         assert(spec, structMap.BroadcastStruct);
      }
   } else if (spec?.kind === ("Unicast" as t.ChannelKind)) {
      assert(spec, structMap.UnicastStruct);
   } else {
      assert(spec, structMap.PortStruct);
   }
}

export function validateChannelSpecs(specs: Partial<t.ChannelSpec>[]): t.ChannelSpec[] {
   const seenChannelNames = new Set<string>();
   const listenerNames: string[] = [];
   for (const spec of specs) {
      validateChannelSpecWithStruct(spec);
      listenerNames.push(...(spec.listeners || []));

      if (spec?.name) {
         if (seenChannelNames.has(spec.name)) {
            throw new Error(`Channel name '${spec.name}' is not unique across application.`);
         } else {
            seenChannelNames.add((spec as t.ChannelSpec).name);
         }
         listenerNames.push(`on${utils.capitalize(spec.name)}`);
      }

      if (spec?.kind) {
         const returnType = spec?.signature?.returnType ?? "";
         const isVoid = ["void", "Promise<void>"].includes(returnType);
         const isLimited = ["Broadcast", "Port"].includes(spec.kind);
         if (isLimited && !isVoid) {
            throw new Error(
               `Channel return type '${returnType}' not allowed when channel kind is '${spec.kind}'`,
            );
         }
      }
   }
   const duplicates = utils.findDuplicates(listenerNames);
   if (duplicates.length > 0) {
      const dupes = duplicates.join("', '");
      throw new Error(`Duplicate listener names not allowed: ['${dupes}']`);
   }
   return specs as t.ChannelSpec[];
}

/**
 * Checks that channel names and listener names are unique across all parsed files.
 * Per-file validation cannot see clashes between files, which would produce duplicate
 * object keys in the generated code and a second handler registration at runtime.
 */
export function validateGlobalChannelSpecs(files: t.ParsedFileSpecs[]): void {
   const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
   const channelOwners = new Map<string, string>();
   const listenerOwners = new Map<string, { file: string; channel: string }>();

   for (const file of sorted) {
      for (const spec of file.specs.channelSpecArray) {
         const firstFile = channelOwners.get(spec.name);
         if (firstFile !== undefined) {
            throw new Error(
               `Channel name '${spec.name}' is declared in both '${firstFile}' and ` +
                  `'${file.relativePath}'. Channel names must be unique across the application.`,
            );
         }
         channelOwners.set(spec.name, file.relativePath);

         const listeners = [...(spec.listeners ?? []), `on${utils.capitalize(spec.name)}`];
         for (const listener of listeners) {
            const first = listenerOwners.get(listener);
            if (first !== undefined) {
               throw new Error(
                  `Listener name '${listener}' of channel '${spec.name}' in ` +
                     `'${file.relativePath}' clashes with a listener of channel ` +
                     `'${first.channel}' in '${first.file}'. Listener names must be ` +
                     "unique across the application.",
               );
            }
            listenerOwners.set(listener, { file: file.relativePath, channel: spec.name });
         }
      }
   }
}

/**
 * Validates the types declared in a schema file. Only the types that a channel signature
 * refers to must be exported, since the generated files import them from the schema file.
 */
export function validateTypeSpecs(
   specs: Partial<t.TypeSpec>[],
   channelSpecs: t.ChannelSpec[] = [],
): t.TypeSpec[] {
   const TypeSpecStruct = object({
      name: string(),
      kind: string(),
      generics: nullable(string()),
      isExported: boolean(),
      isDefault: optional(boolean()),
   });
   for (const spec of specs) {
      assert(spec, TypeSpecStruct);
   }
   for (const spec of specs as t.TypeSpec[]) {
      if (spec.isExported) {
         continue;
      }
      const channel = channelSpecs.find((cs) =>
         cs.signature.customTypes.some((name) => name.split(".")[0] === spec.name),
      );
      if (channel) {
         throw new Error(
            `Type '${spec.name}' is used by channel '${channel.name}' and must be exported. ` +
               `Add 'export' to its declaration.`,
         );
      }
   }
   return specs as t.TypeSpec[];
}

export default {
   validateOptionalConfig,
   validateChannelSpecs,
   validateGlobalChannelSpecs,
   validateTypeSpecs,
};
