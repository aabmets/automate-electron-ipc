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
import { BROWSER_WINDOW_EVENTS } from "./browser-window-events.js";
import utils from "./utils.js";

export function validateOptionalConfig(config: t.IPCOptionalConfig): void {
   const IPCOptionalConfigStruct = object({
      projectUsesNodeNext: boolean(),
      ipcDataDir: refine(string(), "relative", (value) => {
         const errMsg = "ipcDataDir must be relative to the project root";
         return path.isAbsolute(value) ? errMsg : true;
      }),
      rawErrors: optional(boolean()),
      channelPrefix: optional(
         refine(string(), "prefix", (value) => {
            if (value.length > 64) {
               return "channelPrefix cannot be longer than 64 characters";
            }
            return /^[\w.:/@#-]*$/.test(value)
               ? true
               : "channelPrefix can contain only letters, digits and _ . : / @ # -";
         }),
      ),
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

const TriggerStruct = refine(string(), "event", (value) => {
   if (BROWSER_WINDOW_EVENTS.includes(value)) {
      return true;
   }
   return (
      `'${value}' is not a BrowserWindow event. ` +
      `Use one of: ${BROWSER_WINDOW_EVENTS.join(", ")}`
   );
});

/** `scheme://host[:port]` in lower case, as Chromium serializes the origin of a frame. */
const ORIGIN_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9._~%[\]:-]*$/;

const AllowedOriginsStruct = refine(array(string()), "origins", (values) => {
   if (values.length === 0) {
      return "allowedOrigins must list at least one origin, since an empty list allows no caller";
   }
   for (const value of values) {
      if (!ORIGIN_PATTERN.test(value)) {
         return (
            `'${value}' is not an origin. Write the scheme, the host and an optional port, ` +
            "in lower case and without a path, wildcard or credentials, " +
            "such as 'app://.' or 'http://localhost:5173'"
         );
      }
   }
   return true;
});

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

const ValidatorRefStruct = object({
   name: refine(string(), "identifier", (value) =>
      IDENTIFIER_NAME.test(value) ? true : `'${value}' is not an identifier`,
   ),
   exported: refine(string(), "identifier", (value) =>
      IDENTIFIER_NAME.test(value) ? true : `'${value}' is not an exported name`,
   ),
   fromPath: refine(string(), "module", (value) =>
      value.length > 0 ? true : "the module specifier of the validator is empty",
   ),
});

function getChannelSpecStruct(
   kind: t.ChannelKind,
   triggerable = false,
   restrictable = false,
): Struct<any, any> {
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
         customTypes: array(string()),
         async: boolean(),
         typeRefs: optional(array(object({ name: string(), start: number(), end: number() }))),
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
         kind === "Unicast"
            ? optional(
                 object({
                    definition: string(),
                    customTypes: array(string()),
                    typeRefs: optional(
                       array(object({ name: string(), start: number(), end: number() })),
                    ),
                 }),
              )
            : optional(never()),
      trigger: triggerable ? optional(TriggerStruct) : optional(never()),
      allowedOrigins: restrictable ? optional(AllowedOriginsStruct) : optional(never()),
      validate: restrictable ? optional(ValidatorRefStruct) : optional(never()),
   });
}

export function validateChannelSpecWithStruct(spec: Partial<t.ChannelSpec>): void {
   const structMap = {
      TriggerableBroadcastStruct: getChannelSpecStruct("Broadcast", true),
      BroadcastStruct: getChannelSpecStruct("Broadcast", false, true),
      UnicastStruct: getChannelSpecStruct("Unicast", false, true),
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

/**
 * The names that every object has, such as `constructor` and `toString`. A channel object with
 * such a key would hide the member or, as `__proto__` does, change the prototype of the API.
 */
const OBJECT_MEMBER_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

function describeCloneIssue(channel: string, issue: t.CloneIssue): string {
   const via = issue.via ? ` through '${issue.via}'` : "";
   return `Channel '${channel}': ${issue.where} contains ${issue.reason} ('${issue.type}')${via}`;
}

/**
 * Throws if a signature contains what the structured clone algorithm rejects. Electron would
 * throw "An object could not be cloned" for it when the channel is used.
 */
function validateCloneIssues(spec: Partial<t.ChannelSpec>, file?: string): void {
   const errors = (spec.signature?.cloneIssues ?? []).filter((issue) => issue.level === "error");
   if (errors.length === 0) {
      return;
   }
   const where = file === undefined ? "" : `Schema file '${file}': `;
   const lines = errors.map((issue) => {
      const hint = issue.reason === "a Promise" ? PROMISE_HINT : CLONE_HINT;
      return `${where}${describeCloneIssue(spec.name ?? "", issue)}. ${hint}`;
   });
   throw new Error(lines.join("\n"));
}

const CLONE_HINT =
   "It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. " +
   "Send plain data instead, and use a channel to call back.";

const PROMISE_HINT =
   "It cannot be sent over IPC. Only the result of an 'invoke' channel is a Promise, " +
   "so send the resolved value.";

/**
 * The warnings about the signatures of one schema file: the types that Electron sends, but
 * not as they are, such as a class instance that loses its prototype and methods.
 */
export function getCloneWarnings(specs: t.ChannelSpec[], file?: string): string[] {
   const where = file === undefined ? "" : `Schema file '${file}': `;
   return specs.flatMap((spec) =>
      (spec.signature.cloneIssues ?? [])
         .filter((issue) => issue.level === "warning")
         .map(
            (issue) =>
               `${where}${describeCloneIssue(spec.name, issue)}. ` +
               "An instance loses its prototype and methods over IPC and arrives as a plain " +
               "object. Use an interface or a type alias for the data.",
         ),
   );
}

/**
 * Validates the channel specs of one schema file. `file` is only used in error messages.
 */
export function validateChannelSpecs(
   specs: Partial<t.ChannelSpec>[],
   file?: string,
): t.ChannelSpec[] {
   const seenChannelNames = new Set<string>();
   for (const spec of specs) {
      if (spec?.name !== undefined && OBJECT_MEMBER_NAMES.has(spec.name)) {
         const where = file === undefined ? "" : `Schema file '${file}': `;
         throw new Error(
            `${where}Channel name '${spec.name}' is reserved, since it is a member of every ` +
               "object. Choose another name.",
         );
      }
      validateChannelSpecWithStruct(spec);
      validateCloneIssues(spec, file);

      if (spec?.name) {
         if (seenChannelNames.has(spec.name)) {
            throw new Error(`Channel name '${spec.name}' is not unique across application.`);
         } else {
            seenChannelNames.add((spec as t.ChannelSpec).name);
         }
      }

      if (spec?.kind) {
         const returnType = spec?.signature?.returnType ?? "";
         // The parser decides from the AST. Specs that did not come from it fall back to the text.
         const isVoid =
            spec?.signature?.returnsVoid ??
            ["void", "Promise<void>"].includes(returnType.replaceAll(/\s+/g, ""));
         const isLimited = ["Broadcast", "Port"].includes(spec.kind);
         if (isLimited && !isVoid) {
            throw new Error(
               `Channel return type '${returnType}' not allowed when channel kind is '${spec.kind}'`,
            );
         }
      }
   }
   return specs as t.ChannelSpec[];
}

/**
 * Checks that channel names are unique across all parsed files. Per-file validation cannot see
 * clashes between files, which would produce duplicate object keys in the generated code
 * and a second handler registration at runtime.
 */
export function validateGlobalChannelSpecs(files: t.ParsedFileSpecs[]): void {
   // The order of ipcAutomation, so that the file named in an error is the first one processed.
   const normalize = (file: t.ParsedFileSpecs) => file.relativePath.replaceAll("\\", "/");
   const sorted = [...files].sort((a, b) => utils.compareStrings(normalize(a), normalize(b)));
   const channelOwners = new Map<string, string>();

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
      }
   }
}

/**
 * Validates the types and values declared in a schema file. Only the ones that a channel
 * signature refers to must be exported, since the generated files import them from the schema file.
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
      exportedAs: optional(string()),
   });
   for (const spec of specs) {
      assert(spec, TypeSpecStruct);
   }
   for (const spec of specs as t.TypeSpec[]) {
      if (spec.isExported) {
         continue;
      }
      const channel = channelSpecs.find((cs) =>
         [...cs.signature.customTypes, ...(cs.errors?.customTypes ?? [])].some(
            (name) => name.split(".")[0] === spec.name,
         ),
      );
      if (channel) {
         const subject =
            spec.kind === "value"
               ? `Value '${spec.name}' is used by channel '${channel.name}' through ` +
                 `'typeof ${spec.name}'`
               : `Type '${spec.name}' is used by channel '${channel.name}'`;
         throw new Error(`${subject} and must be exported. Add 'export' to its declaration.`);
      }
   }
   return specs as t.TypeSpec[];
}

export default {
   validateOptionalConfig,
   validateChannelSpecs,
   validateGlobalChannelSpecs,
   validateTypeSpecs,
   getCloneWarnings,
};
