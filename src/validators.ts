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
import { isReservedGlobalName } from "./reserved-globals.js";
import utils from "./utils.js";

export function validateOptionalConfig(config: t.IPCOptionalConfig): void {
   const IPCOptionalConfigStruct = object({
      projectUsesNodeNext: boolean(),
      ipcDataDir: refine(string(), "relative", (value) => {
         const errMsg = "ipcDataDir must be relative to the project root";
         return path.isAbsolute(value) ? errMsg : true;
      }),
      rawErrors: optional(boolean()),
      utilityBindingsPath: optional(
         refine(string(), "relative", (value) => {
            if (path.isAbsolute(value)) {
               return "utilityBindingsPath must be relative to the project root";
            }
            return /\.[cm]?ts$/.test(value) && !value.endsWith(".d.ts")
               ? true
               : "utilityBindingsPath must be the path of a .ts file";
         }),
      ),
      serviceWorkerPreloadPath: optional(
         refine(string(), "relative", (value) => {
            if (path.isAbsolute(value)) {
               return "serviceWorkerPreloadPath must be relative to the project root";
            }
            return /\.[cm]?ts$/.test(value) && !value.endsWith(".d.ts")
               ? true
               : "serviceWorkerPreloadPath must be the path of a .ts file";
         }),
      ),
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
      timeoutMs: optional(
         refine(number(), "timeout", (value) =>
            Number.isSafeInteger(value) && value >= 0
               ? true
               : "timeoutMs must be a non-negative integer",
         ),
      ),
      exposeAs: optional(
         refine(string(), "identifier", (value) => {
            if (!/^[A-Za-z_$][\w$]*$/.test(value)) {
               return "exposeAs must be an identifier: letters, digits, _ and $, not starting with a digit";
            }
            return isReservedGlobalName(value)
               ? `exposeAs '${value}' is a reserved word or a global of the page. Choose another name.`
               : true;
         }),
      ),
      isolatedWorldId: optional(
         refine(number(), "world", (value) =>
            Number.isInteger(value) && value >= 1000 && value <= 2 ** 31 - 1
               ? true
               : "isolatedWorldId must be an integer of 1000 or more, up to 2147483647",
         ),
      ),
      autoExpose: optional(boolean()),
      getPathForFile: optional(boolean()),
      serializer: optional(
         refine(string(), "module", (value) => {
            if (value.startsWith(".")) {
               return /^\.{1,2}\/[^\0\r\n]+$/.test(value)
                  ? true
                  : "serializer must start with ./ or ../ when it is a path in the project";
            }
            return /^(@[\w.-]+\/)?[\w.-]+(\/[\w.@-]+)*$/.test(value)
               ? true
               : "serializer must be a package name such as 'superjson', or a path that starts with ./ or ../";
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

/** The names of scopes are part of file names, so they are lower case words joined by dashes. */
const SCOPE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_SCOPE_NAME_LENGTH = 32;
/** The name of the scope of the channels that have no `scopes`, which is the name of no scope. */
const RESERVED_SCOPE_NAME = "default";

const ScopesStruct = refine(array(string()), "scopes", (values) => {
   if (values.length === 0) {
      return "scopes must list at least one scope, since an empty list puts the channel in no window";
   }
   const seen = new Set<string>();
   for (const value of values) {
      if (value === RESERVED_SCOPE_NAME) {
         return `'${RESERVED_SCOPE_NAME}' is the scope of the channels without scopes. Choose another name`;
      } else if (value.length > MAX_SCOPE_NAME_LENGTH || !SCOPE_NAME_PATTERN.test(value)) {
         return (
            `'${value}' is not a scope name. Use lower case letters and digits, joined by dashes ` +
            `and starting with a letter, up to ${MAX_SCOPE_NAME_LENGTH} characters, such as 'settings' or 'plugin-host'`
         );
      } else if (seen.has(value)) {
         return `scope '${value}' is listed twice`;
      }
      seen.add(value);
   }
   return true;
});

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;
/** A channel name is emitted as an object key, so any ECMAScript identifier name is valid. */
const CHANNEL_NAME = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*$/u;

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
         (kind === "Unicast" && !asking && !utility && !workerNotify) || streaming
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
      allowedOrigins:
         restrictable || workerCall ? optional(AllowedOriginsStruct) : optional(never()),
      validate: restrictable ? optional(ValidatorRefStruct) : optional(never()),
      scopes: scoped ? optional(ScopesStruct) : optional(never()),
      maxQueue: bounded ? optional(number()) : optional(never()),
      highWaterMark: streaming ? optional(number()) : optional(never()),
      timeoutMs:
         kind === "Unicast" && !asking && !utility && !brokered && !workerCall && !workerNotify
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

/**
 * Throws if `maxQueue` or `highWaterMark` is not a non-negative safe integer or `Infinity`. The
 * parser reports the same for the schema file, so this guards the specs that did not come from it.
 */
function validateCountLimit(
   spec: Partial<t.ChannelSpec>,
   option: "maxQueue" | "highWaterMark",
   file?: string,
): void {
   const value = spec[option];
   if (value === undefined || value === Number.POSITIVE_INFINITY) {
      return;
   } else if (!Number.isSafeInteger(value) || value < 0) {
      const where = file === undefined ? "" : `Schema file '${file}': `;
      throw new Error(
         `${where}Channel '${spec.name}': ${option} must be a non-negative integer or Infinity, ` +
            `found ${value}.`,
      );
   }
}

/**
 * Throws if `timeoutMs` is not a non-negative safe integer. The parser reports the same for the
 * schema file, so this guards the specs that did not come from it.
 */
function validateTimeoutMs(spec: Partial<t.ChannelSpec>, file?: string): void {
   const value = spec.timeoutMs;
   if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      const where = file === undefined ? "" : `Schema file '${file}': `;
      throw new Error(
         `${where}Channel '${spec.name}': timeoutMs must be a non-negative integer, found ${value}.`,
      );
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
      validateCountLimit(spec, "maxQueue", file);
      validateCountLimit(spec, "highWaterMark", file);
      validateTimeoutMs(spec, file);
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
 * Checks that no channel takes the name of a member that the library adds to the API of the page.
 * That is `getPathForFile`, while the config asks for it: a channel of that name would be
 * overwritten by the helper, or the other way round.
 */
export function validateReservedApiNames(
   files: t.ParsedFileSpecs[],
   config: Pick<t.IPCOptionalConfig, "getPathForFile">,
): void {
   if (!config.getPathForFile) {
      return;
   }
   for (const file of files) {
      for (const spec of file.specs.channelSpecArray) {
         if (spec.name === "getPathForFile") {
            throw new Error(
               `Schema file '${file.relativePath}': Channel name 'getPathForFile' is reserved, ` +
                  "since the config 'getPathForFile' adds a member of that name to the API. " +
                  "Rename the channel, or turn the config off.",
            );
         }
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
   validateReservedApiNames,
   validateTypeSpecs,
   getCloneWarnings,
};
