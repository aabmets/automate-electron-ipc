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
import type { AstNode } from "../ast.js";
import { forEachChild, unwrapExpression } from "../ast.js";
import { isDefineChannelsCall, type LibraryImports } from "../library-imports.js";

export interface ExportedMap {
   call: AstNode;
   exported: t.ChannelMapExport;
}

/**
 * Finds the `defineChannels` call that a module-level statement exports, if any.
 */
export function findExportedMap(item: AstNode, imports: LibraryImports): ExportedMap | null {
   if (item.type === "ExportDefaultExpression") {
      const call = unwrapExpression(item.expression);
      return isDefineChannelsCall(call, imports) ? { call, exported: { kind: "default" } } : null;
   } else if (
      item.type === "ExportDeclaration" &&
      item.declaration.type === "VariableDeclaration"
   ) {
      for (const decl of item.declaration.declarations as AstNode[]) {
         const init = decl.init ? unwrapExpression(decl.init) : null;
         if (decl.id.type === "Identifier" && init && isDefineChannelsCall(init, imports)) {
            return { call: init, exported: { kind: "named", name: decl.id.value } };
         }
      }
   }
   return null;
}

/**
 * Finds the name under which `export default m` or `export { m }` exports the local `m`.
 */
function findExportOfLocal(body: AstNode[], local: string): t.ChannelMapExport | null {
   for (const item of body) {
      const exported = exportOfLocalIn(item, local);
      if (exported) {
         return exported;
      }
   }
   return null;
}

/** The export that one module item makes of the local `local`, if it does. */
function exportOfLocalIn(item: AstNode, local: string): t.ChannelMapExport | null {
   if (item.type === "ExportDefaultExpression") {
      const expr = unwrapExpression(item.expression);
      return expr.type === "Identifier" && expr.value === local ? { kind: "default" } : null;
   }
   if (item.type !== "ExportNamedDeclaration" || item.source) {
      return null;
   }
   const spec = (item.specifiers as AstNode[]).find(
      (s) => s.type === "ExportSpecifier" && s.orig.value === local,
   );
   if (!spec) {
      return null;
   }
   const name: string = spec.exported?.value ?? local;
   return name === "default" ? { kind: "default" } : { kind: "named", name };
}

/**
 * Finds a `const m = defineChannels(...)` that is exported later through
 * `export default m` or `export { m }`.
 */
export function findIndirectlyExportedMap(
   body: AstNode[],
   imports: LibraryImports,
): ExportedMap | null {
   const declarators = body
      .filter((item) => item.type === "VariableDeclaration")
      .flatMap((item) => item.declarations as AstNode[]);
   for (const decl of declarators) {
      const init = decl.init ? unwrapExpression(decl.init) : null;
      if (decl.id.type === "Identifier" && init && isDefineChannelsCall(init, imports)) {
         const exported = findExportOfLocal(body, decl.id.value);
         if (exported) {
            return { call: init, exported };
         }
      }
   }
   return null;
}

export function collectDefineChannelsCalls(
   node: AstNode,
   imports: LibraryImports,
   out: AstNode[],
): void {
   if (isDefineChannelsCall(node, imports)) {
      out.push(node);
   }
   forEachChild(node, (child) => collectDefineChannelsCalls(child, imports, out));
}
