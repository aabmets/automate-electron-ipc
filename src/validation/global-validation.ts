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
import { assert, boolean, nullable, object, optional, string } from "superstruct";
import utils from "../utils.js";

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
      aliasOf: optional(string()),
   });
   for (const spec of specs) {
      assert(spec, TypeSpecStruct);
   }
   // An alias of `import X = Ns.Y` that is not exported is resolved to its target in the generated
   // files, so the head of the target, and not the alias, is what a channel uses.
   const aliasHeads = new Map<string, string>();
   for (const spec of specs as t.TypeSpec[]) {
      if (!spec.isExported && spec.aliasOf !== undefined) {
         aliasHeads.set(spec.name, spec.aliasOf.split(".")[0]);
      }
   }
   const usedNames = (cs: t.ChannelSpec): Set<string> => {
      const used = new Set<string>();
      const written = [...cs.signature.customTypes, ...(cs.errors?.customTypes ?? [])];
      for (const name of written.map((entry) => entry.split(".")[0])) {
         for (let n: string | undefined = name; n !== undefined && !used.has(n); ) {
            used.add(n);
            n = aliasHeads.get(n);
         }
      }
      return used;
   };
   for (const spec of specs as t.TypeSpec[]) {
      if (spec.isExported || aliasHeads.has(spec.name)) {
         continue;
      }
      const channel = channelSpecs.find((cs) => usedNames(cs).has(spec.name));
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
