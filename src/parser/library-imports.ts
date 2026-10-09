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

import type { Module } from "@swc/core";
import type { AstNode } from "./ast.js";

const PACKAGE_NAME = "automate-electron-ipc";

/**
 * Names that the schema file imports from this library, keyed by their local name.
 * Values are the exported names, such as `invoke` for `import { invoke as inv }`.
 */
export interface LibraryImports {
   named: Map<string, string>;
   namespaces: Set<string>;
}

export function collectLibraryImports(module: Module): LibraryImports {
   const imports: LibraryImports = { named: new Map(), namespaces: new Set() };
   for (const item of module.body) {
      if (item.type !== "ImportDeclaration" || item.source.value !== PACKAGE_NAME) {
         continue;
      }
      for (const spec of item.specifiers) {
         if (spec.type === "ImportNamespaceSpecifier") {
            imports.namespaces.add(spec.local.value);
         } else if (spec.type === "ImportSpecifier") {
            imports.named.set(spec.local.value, spec.imported?.value ?? spec.local.value);
         }
      }
   }
   return imports;
}

/**
 * Resolves the callee of a call expression to the name that the library exports,
 * following aliased and namespace imports. Returns null for unrelated callees.
 */
export function resolveLibraryName(callee: AstNode, imports: LibraryImports): string | null {
   if (callee.type === "Identifier") {
      return imports.named.get(callee.value) ?? null;
   } else if (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      imports.namespaces.has(callee.object.value)
   ) {
      return callee.property.value;
   }
   return null;
}

export function isDefineChannelsCall(node: AstNode, imports: LibraryImports): boolean {
   return (
      node.type === "CallExpression" &&
      resolveLibraryName(node.callee, imports) === "defineChannels"
   );
}
