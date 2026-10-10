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

import type { AstNode, Source, SpanRef } from "../ast.js";
import { forEachChild } from "../ast.js";
import { isBuiltinType } from "./builtin-types.js";

/** The first name of a possibly qualified name: `Kind` for `Kind.A`. */
function headOf(name: string): string {
   return name.split(".")[0];
}

/** The leftmost identifier of a possibly qualified name, such as `Kind` in `Kind.A`. */
function headNode(name: AstNode): AstNode | null {
   let current = name;
   while (current.type === "TsQualifiedName") {
      current = current.left;
   }
   return current.type === "Identifier" ? current : null;
}

/**
 * Names of the type parameters that a node brings into scope for its subtree:
 * `<T>` of a function type, interface or alias, the `P` of `{ [P in K]: ... }`
 * and the `infer U` names of a conditional type, which are scoped to the whole conditional.
 */
function declaredTypeParams(node: AstNode): string[] {
   const names: string[] = (node.typeParams?.parameters ?? []).map((tp: AstNode) => tp.name.value);
   if (node.type === "TsMappedType") {
      names.push(node.typeParam.name.value);
   } else if (node.type === "TsConditionalType") {
      const visit = (child: AstNode) => {
         if (child.type === "TsInferType") {
            names.push(child.typeParam.name.value);
         }
         forEachChild(child, visit);
      };
      visit(node.extendsType);
   }
   return names;
}

function collectTypeReference(
   node: AstNode,
   src: Source,
   set: Set<string>,
   inScope: ReadonlySet<string>,
   locals: ReadonlySet<string>,
   refs?: SpanRef[],
): void {
   // A qualified name such as `Kind.A` is kept whole. Its head is resolved by the writers.
   const typeName = src.text(node.typeName);
   const head = headOf(typeName);
   if (isBuiltinType(head, locals) || inScope.has(head)) {
      return;
   }
   set.add(typeName);
   const identifier = headNode(node.typeName);
   if (identifier) {
      refs?.push({ name: head, span: identifier.span });
   }
}

function collectTypeQuery(
   node: AstNode,
   set: Set<string>,
   inScope: ReadonlySet<string>,
   refs?: SpanRef[],
): void {
   const identifier = headNode(node.exprName);
   if (identifier && !inScope.has(identifier.value)) {
      set.add(identifier.value);
      refs?.push({ name: identifier.value, span: identifier.span });
   }
}

/** Records what the node itself refers to, apart from its children. */
function collectOwnReferences(
   node: AstNode,
   src: Source,
   set: Set<string>,
   inScope: ReadonlySet<string>,
   locals: ReadonlySet<string>,
   refs?: SpanRef[],
): void {
   if (node.type === "TsTypeReference") {
      collectTypeReference(node, src, set, inScope, locals, refs);
   } else if (node.type === "TsTypeQuery") {
      collectTypeQuery(node, set, inScope, refs);
   } else if (node.type === "TsImportType") {
      // `import("./models").User` names its module by a path relative to the schema file, so the
      // path is recorded to be rebased. Its qualifier and type arguments are visited as children.
      const argument = node.argument;
      if (argument?.type === "StringLiteral" && argument.value.startsWith(".")) {
         refs?.push({ name: "import()", span: argument.span, importPath: argument.value });
      }
   } else if (node.type === "ImportDeclaration") {
      for (const element of node.specifiers) {
         const name = element.local.value;
         if (element.type === "ImportSpecifier" && (node.typeOnly || element.isTypeOnly)) {
            set.add(name);
         }
      }
   }
}

/**
 * Collects the names of the types that a node refers to and that the generated files must import.
 * `scope` are the type parameters in scope, `locals` the names that the schema file binds itself.
 * If `refs` is given, the span of the leftmost identifier of every such reference is appended to
 * it, so that the writers can rename a type by position instead of by scanning text.
 */
export function collectCustomTypes(
   node: AstNode,
   src: Source,
   set: Set<string>,
   scope: ReadonlySet<string> = new Set(),
   locals: ReadonlySet<string> = new Set(),
   refs?: SpanRef[],
): void {
   if (!node) {
      return;
   }
   const declared = declaredTypeParams(node);
   const inScope = declared.length > 0 ? new Set([...scope, ...declared]) : scope;
   collectOwnReferences(node, src, set, inScope, locals, refs);
   forEachChild(node, (child) => collectCustomTypes(child, src, set, inScope, locals, refs));
}
