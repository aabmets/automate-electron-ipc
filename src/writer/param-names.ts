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

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const IDENTIFIER_TOKENS = /[A-Za-z_$][\w$]*/g;

/**
 * Collects every identifier-like token of the given source snippets.
 * Names that are absent from the result cannot clash with anything in the snippets.
 */
export function collectIdentifiers(snippets: string[]): Set<string> {
   return new Set(snippets.flatMap((snippet) => snippet.match(IDENTIFIER_TOKENS) ?? []));
}

/**
 * Returns `base`, with underscores prepended until it is absent from `taken`,
 * and adds the result to `taken`.
 */
export function uniqueName(base: string, taken: Set<string>): string {
   let name = base;
   while (taken.has(name)) {
      name = `_${name}`;
   }
   taken.add(name);
   return name;
}

/**
 * Returns the parameters of the channel signature with names that are valid identifiers.
 * Destructured parameters, such as `{ a, b }: Foo`, cannot be forwarded by name,
 * so they are replaced by generated names that clash with no name in the signature.
 */
export function resolveParams(spec: t.ChannelSpec): t.CallableParam[] {
   const params = spec.signature.params;
   const taken = collectIdentifiers(params.map((param) => param.name));
   return params.map((param, index) => {
      if (IDENTIFIER_PATTERN.test(param.name)) {
         return param;
      }
      return { ...param, name: uniqueName(`arg${index}`, taken) };
   });
}

export function getOriginalParams(spec: t.ChannelSpec, onlyNames: boolean): string {
   return resolveParams(spec)
      .map((param) => {
         const rest = param.rest ? "..." : "";
         if (onlyNames) {
            return `${rest}${param.name}`;
         }
         const optional = param.optional ? "?" : "";
         return `${rest}${param.name}${optional}: ${param.type || "any"}`;
      })
      .join(", ");
}
