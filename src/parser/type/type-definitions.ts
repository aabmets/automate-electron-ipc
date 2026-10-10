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
import type { AstNode, Source, TypeDefinitionNode } from "../ast.js";
import { declarationOf, TYPE_KINDS } from "../module-bindings.js";

/** The names that a binding pattern declares: `a`, `b` and `c` for `{ a, b: [c] }`. */
function patternNames(pattern: AstNode | null): string[] {
   switch (pattern?.type) {
      case "Identifier":
         return [pattern.value];
      case "ArrayPattern":
         return (pattern.elements as (AstNode | null)[]).flatMap(patternNames);
      case "ObjectPattern":
         return (pattern.properties as AstNode[]).flatMap((prop) => {
            if (prop.type === "KeyValuePatternProperty") {
               return patternNames(prop.value);
            }
            return prop.type === "AssignmentPatternProperty"
               ? [prop.key.value]
               : patternNames(prop);
         });
      case "AssignmentPattern":
         return patternNames(pattern.left);
      case "RestElement":
         return patternNames(pattern.argument);
      default:
         return [];
   }
}

/** The names that a variable or function declaration declares, for `typeof` queries. */
function valueNames(node: AstNode): string[] {
   if (node.type === "VariableDeclaration") {
      return (node.declarations as AstNode[]).flatMap((decl) => patternNames(decl.id));
   }
   // `export default function () {}` declares no name.
   return node.identifier ? [node.identifier.value] : [];
}

const VALUE_DECLARATIONS = new Set(["VariableDeclaration", "FunctionDeclaration"]);

export function isValueDefinition(node: AstNode): boolean {
   // swc parses `export default function f() {}` as a function expression.
   return VALUE_DECLARATIONS.has(node.type) || node.type === "FunctionExpression";
}

/**
 * Records the variables and functions that the schema file declares as specs of kind "value".
 * A signature may query them with `typeof`, which makes the generated files import them,
 * so they must be exported like types. Classes, enums and namespaces are recorded as types.
 */
export function parseValueDefinitions(item: AstNode, array: t.TypeSpec[]): void {
   const isExported = item.type === "ExportDeclaration" || item.type === "ExportDefaultDeclaration";
   for (const name of valueNames(declarationOf(item))) {
      array.push({
         name,
         kind: "value",
         generics: null,
         isExported,
         ...(item.type === "ExportDefaultDeclaration" ? { isDefault: true } : {}),
      });
   }
}

export function parseTypeDefinitions(
   item: TypeDefinitionNode,
   src: Source,
   array: t.TypeSpec[],
): void {
   const isExported = item.type === "ExportDeclaration" || item.type === "ExportDefaultDeclaration";
   const node = declarationOf(item);

   let generics: string | null = null;
   if (node.typeParams && node.typeParams.parameters.length > 0) {
      const typeParams = node.typeParams.parameters.map((tp: AstNode) => src.text(tp)).join(", ");
      generics = `<${typeParams}>`;
   }
   array.push({
      name: (node.id ?? node.identifier).value,
      kind: TYPE_KINDS.get(node.type) as t.TypeKind,
      generics,
      isExported,
      ...(item.type === "ExportDefaultDeclaration" ? { isDefault: true } : {}),
   });
}

/**
 * Marks the local types and values that the module exports through `export { X }`,
 * `export { X as Y }`, `export { X as default }` or `export default X`. Re-exports from another
 * module declare nothing local, and neither do imports, so they match no spec and are ignored.
 * When a type is exported several times, the export under its own name wins, then the first.
 */
export function applyExportSpecifiers(body: AstNode[], typeSpecs: t.TypeSpec[]): void {
   const exportNames = new Map<string, string[]>();
   const add = (local: string, exported: string) => {
      exportNames.set(local, [...(exportNames.get(local) ?? []), exported]);
   };
   for (const item of body) {
      if (item.type === "ExportDefaultExpression" && item.expression.type === "Identifier") {
         add(item.expression.value, "default");
      } else if (item.type === "ExportNamedDeclaration" && !item.source) {
         for (const spec of item.specifiers as AstNode[]) {
            if (spec.type === "ExportSpecifier") {
               add(spec.orig.value, (spec.exported ?? spec.orig).value);
            }
         }
      }
   }
   for (const spec of typeSpecs) {
      const names = exportNames.get(spec.name);
      if (spec.isExported || !names) {
         continue;
      }
      const exported = names.includes(spec.name) ? spec.name : names[0];
      spec.isExported = true;
      if (exported === "default") {
         spec.isDefault = true;
      } else if (exported !== spec.name) {
         spec.exportedAs = exported;
      }
   }
}
