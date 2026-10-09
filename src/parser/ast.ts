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

import type {
   ClassDeclaration,
   ExportDeclaration,
   ExportDefaultDeclaration,
   Module,
   Span,
   TsEnumDeclaration,
   TsInterfaceDeclaration,
   TsModuleDeclaration,
   TsTypeAliasDeclaration,
} from "@swc/core";
import { parseSync } from "@swc/core";

export interface AstNode {
   type: string;
   span: Span;
   [key: string]: any;
}

/** A reference to a type by name, with the swc span of the identifier. */
export interface SpanRef {
   name: string;
   span: Span;
   /** For the argument of an import type: its specifier, which `name` and `span` stand for. */
   importPath?: string;
}

export interface Source {
   text: (node: { span: Span }) => string;
}

export type TypeDefinitionNode =
   | TsInterfaceDeclaration
   | TsTypeAliasDeclaration
   | TsEnumDeclaration
   | TsModuleDeclaration
   | ClassDeclaration
   | ExportDeclaration
   | ExportDefaultDeclaration;

const BOM = 0xfeff;

export function parseModule(code: string): { module: Module; src: Source } {
   const module = parseSync(code, {
      // Decorators (an ORM entity in a model file of the schema directory) are only syntax here.
      syntax: "typescript",
      decorators: true,
      target: "esnext",
   });
   // swc spans are 1-based offsets into the source of each parse call, counted in UTF-8 bytes
   // and not in UTF-16 code units, and swc does not count a leading BOM.
   const base = 1;
   const bytes = Buffer.from(code.charCodeAt(0) === BOM ? code.slice(1) : code, "utf8");
   const src: Source = {
      text: (node) => bytes.toString("utf8", node.span.start - base, node.span.end - base),
   };
   return { module, src };
}

export function forEachChild(node: AstNode, callback: (child: AstNode) => void): void {
   for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
         if (child && typeof child === "object") {
            if (typeof child.type === "string") {
               callback(child);
            } else {
               // Wrapper objects without a node type, such as call arguments.
               forEachChild(child, callback);
            }
         }
      }
   }
}

export function unwrapParentheses(node: AstNode): AstNode {
   let current = node;
   while (current.type === "ParenthesisExpression") {
      current = current.expression;
   }
   return current;
}

const EXPRESSION_WRAPPERS = new Set([
   "ParenthesisExpression",
   "TsAsExpression",
   "TsSatisfiesExpression",
   "TsConstAssertion",
   "TsNonNullExpression",
   "TsTypeAssertion",
]);

/**
 * Unwraps the syntax that does not change the value of an expression: parentheses, and the
 * `as`, `as const`, `satisfies`, `<T>` and `!` operators, such as in
 * `export default defineChannels({...}) satisfies Foo`.
 */
export function unwrapExpression(node: AstNode): AstNode {
   let current = node;
   while (EXPRESSION_WRAPPERS.has(current.type)) {
      current = current.expression;
   }
   return current;
}

export function unwrapTypeParentheses(node: AstNode): AstNode {
   let current = node;
   while (current.type === "TsParenthesizedType") {
      current = current.typeAnnotation;
   }
   return current;
}
