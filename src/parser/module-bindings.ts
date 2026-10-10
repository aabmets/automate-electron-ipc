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
import type * as t from "@types";
import type { AstNode } from "./ast.js";

/** The declaration of a module item, unwrapping `export` and `export default`. */
export function declarationOf(item: AstNode): AstNode {
   if (item.type === "ExportDeclaration") {
      return item.declaration;
   }
   return item.type === "ExportDefaultDeclaration" ? item.decl : item;
}

export const TYPE_KINDS = new Map<string, t.TypeKind>([
   ["TsInterfaceDeclaration", "interface"],
   ["TsTypeAliasDeclaration", "type"],
   ["TsEnumDeclaration", "enum"],
   ["TsModuleDeclaration", "namespace"],
   ["ClassDeclaration", "class"],
   // swc parses `export default class X {}` as a class expression.
   ["ClassExpression", "class"],
]);

export function isTypeDefinition(node: AstNode): boolean {
   if (node.type === "ClassExpression") {
      // `export default class {}` declares no name.
      return !!node.identifier;
   } else if (node.type === "TsModuleDeclaration") {
      // `declare module "name"` and `declare global` declare no name.
      return node.id.type === "Identifier" && !node.global;
   }
   return TYPE_KINDS.has(node.type);
}

/**
 * The names that a schema file binds at module level and may use as types: every import
 * (named, default, namespace and `import X = ...`) and every interface, type alias, enum,
 * namespace and class.
 */
export function collectModuleBindings(module: Module): Set<string> {
   const names = new Set<string>();
   for (const node of module.body) {
      const item = node as AstNode;
      if (item.type === "TsImportEqualsDeclaration") {
         names.add(item.id.value);
         continue;
      }
      if (item.type === "ImportDeclaration") {
         for (const element of item.specifiers as AstNode[]) {
            names.add(element.local.value);
         }
         continue;
      }
      const declaration = declarationOf(item);
      if (isTypeDefinition(declaration)) {
         names.add((declaration.id ?? declaration.identifier).value);
      }
   }
   return names;
}

/** Local type declarations of the schema file by name, which a signature may refer to. */
export type TypeDeclarations = ReadonlyMap<string, AstNode[]>;

const RESOLVABLE_DECLARATIONS = new Set([
   "TsTypeAliasDeclaration",
   "TsInterfaceDeclaration",
   "ClassDeclaration",
   "ClassExpression",
]);

/**
 * The aliases, interfaces and classes that the schema file declares at module level, by name.
 * An interface may be declared several times.
 */
export function collectTypeDeclarations(module: Module): TypeDeclarations {
   const declarations = new Map<string, AstNode[]>();
   for (const node of module.body) {
      const item = node as AstNode;
      const declaration = declarationOf(item);
      if (!RESOLVABLE_DECLARATIONS.has(declaration.type)) {
         continue;
      }
      const name = (declaration.id ?? declaration.identifier)?.value;
      if (name) {
         declarations.set(name, [...(declarations.get(name) ?? []), declaration]);
      }
   }
   return declarations;
}
