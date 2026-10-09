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
import utils from "./utils.js";

/**
 * The scopes of a schema divide the API that the windows get. A channel without `scopes` is open
 * to all windows, so every surface has it. A channel with `scopes` is only in the surface of each
 * scope that it lists. The surface of no scope, `null`, has the channels without `scopes` only, and
 * is what a window gets that belongs to no scope.
 */
export type Scope = string | null;

/** Whether the channel is in the surface of the scope. */
export function isInScope(spec: t.ChannelSpec, scope: Scope): boolean {
   if (!spec.scopes) {
      return true;
   }
   return scope !== null && spec.scopes.includes(scope);
}

/** The scopes that the channels of the schema files list, in code unit order. */
export function collectScopes(pfsArray: readonly t.ParsedFileSpecs[]): string[] {
   const scopes = new Set<string>();
   for (const pfs of pfsArray) {
      for (const spec of pfs.specs.channelSpecArray) {
         for (const scope of spec.scopes ?? []) {
            scopes.add(scope);
         }
      }
   }
   return [...scopes].sort(utils.compareStrings);
}

/**
 * The schema files with only the channels of the surface of the scope. A file which has none left
 * is dropped, so that a surface with no channels is the same as an empty schema.
 */
export function filterByScope(
   pfsArray: readonly t.ParsedFileSpecs[],
   scope: Scope,
): t.ParsedFileSpecs[] {
   return pfsArray
      .map((pfs) => ({
         ...pfs,
         specs: {
            ...pfs.specs,
            channelSpecArray: pfs.specs.channelSpecArray.filter((spec) => isInScope(spec, scope)),
         },
      }))
      .filter((pfs) => pfs.specs.channelSpecArray.length > 0);
}

/**
 * The path of the file of a scope, next to the file of the surface of no scope: `preload.ts`
 * becomes `preload.settings.ts`, `window.d.ts` becomes `window.settings.d.ts` and `types.ts` becomes
 * `types.settings.ts`.
 */
export function scopedFilePath(filePath: string, scope: Scope): string {
   const extension = /(\.d\.ts|\.ts)$/.exec(filePath);
   if (scope === null || !extension) {
      return filePath;
   }
   return `${filePath.slice(0, extension.index)}.${scope}${extension[0]}`;
}

/**
 * The scope that the file is the file of, when it is named after one next to `basePath` as
 * `scopedFilePath` does, such as `settings` for `preload.settings.ts` and `preload.ts`. A file of
 * no scope, or of another base, gives `null`.
 */
export function scopeOfFile(basePath: string, file: string): Scope {
   const extension = /(\.d\.ts|\.ts)$/.exec(basePath);
   if (!extension) {
      return null;
   }
   const prefix = `${utils.toPosix(basePath.slice(0, extension.index))}.`;
   const posixFile = utils.toPosix(file);
   if (!(posixFile.startsWith(prefix) && posixFile.endsWith(extension[0]))) {
      return null;
   }
   const scope = posixFile.slice(prefix.length, posixFile.length - extension[0].length);
   return /^[^./]+$/.test(scope) ? scope : null;
}
