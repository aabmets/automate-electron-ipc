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
import type { SourcePosition } from "@types";
import { renderCodeFrame } from "./diagnostics.js";

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
   /** The 1-based line and column (UTF-16 code units, as editors count) of the start of a span. */
   position: (span: Span) => SourcePosition;
   /** The code frame of a span, see `renderCodeFrame`. */
   frame: (span: Span) => string;
}

export type TypeDefinitionNode =
   | TsInterfaceDeclaration
   | TsTypeAliasDeclaration
   | TsEnumDeclaration
   | TsModuleDeclaration
   | ClassDeclaration
   | ExportDeclaration
   | ExportDefaultDeclaration;

/**
 * The span of a node. A property of an object literal has none of its own: `key: value` spans from
 * its key to its value, and a spread element spans from the dots to its argument.
 */
export function nodeSpan(node: AstNode): Span {
   if (node.span) {
      return node.span;
   } else if (node.type === "SpreadElement") {
      return { start: node.spread.start, end: node.arguments.span.end, ctxt: 0 };
   }
   return { start: node.key.span.start, end: node.value.span.end, ctxt: 0 };
}

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
   const text = code.charCodeAt(0) === BOM ? code.slice(1) : code;
   const bytes = Buffer.from(text, "utf8");
   const isAscii = bytes.length === text.length;
   const indexOf = (offset: number) =>
      isAscii ? offset - base : bytes.toString("utf8", 0, offset - base).length;
   const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
   const lineStarts = [0];
   for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
      lineStarts.push(i + 1);
   }
   const locate = (offset: number): SourcePosition => {
      const index = indexOf(offset);
      const line = lineStarts.findLastIndex((start) => start <= index);
      return { line: line + 1, column: index - lineStarts[line] + 1 };
   };
   const src: Source = {
      text: (node) => bytes.toString("utf8", node.span.start - base, node.span.end - base),
      position: (span) => locate(span.start),
      frame: (span) => {
         const start = locate(span.start);
         const end = locate(span.end);
         return renderCodeFrame(lines, start, end.line === start.line ? end.column : undefined);
      },
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
