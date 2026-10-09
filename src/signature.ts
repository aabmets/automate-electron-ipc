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

import type { Param, Span, TsFunctionType } from "@swc/core";
import type * as t from "@types";
import type { AstNode, Source, SpanRef } from "./ast.js";
import { unwrapTypeParentheses } from "./ast.js";
import type { CloneWalk } from "./clone-check.js";
import { typeParamScope, walkCloneType } from "./clone-check.js";
import type { TypeDeclarations } from "./module-bindings.js";
import { collectCustomTypes } from "./type-references.js";

function getParamInfo(param: Param["pat"], src: Source): t.CallableParam {
   const node = param as AstNode;
   const annotation = node.typeAnnotation?.typeAnnotation;
   const type = annotation ? src.text(annotation) : "any";
   if (node.type === "RestElement") {
      const arg = node.argument as AstNode;
      const name = arg.type === "Identifier" ? arg.value : src.text(arg as { span: Span });
      return { name, type, rest: true, optional: false };
   } else if (node.type === "Identifier") {
      return { name: node.value, type, rest: false, optional: !!node.optional };
   }
   const end = node.typeAnnotation ? node.typeAnnotation.span.start : node.span.end;
   const name = src.text({ span: { ...node.span, end } }).trim();
   return { name, type, rest: false, optional: !!node.optional };
}

/**
 * Tells whether a type node is the global `Promise<...>`, and nothing that merely starts with
 * "Promise", such as a user type `PromiseResult`, `PromiseLike<T>` or `Foo.Promise<T>`.
 */
function isPromiseType(node: AstNode): boolean {
   const type = unwrapTypeParentheses(node);
   return (
      type.type === "TsTypeReference" &&
      type.typeName.type === "Identifier" &&
      type.typeName.value === "Promise"
   );
}

/**
 * Finds the offset in the text of a function type just after the `(` that opens its
 * parameter list. It skips the type parameters, whose own `(` may appear in constraints
 * such as `<T extends (x: number) => void>`, and any comments in front of the `(`.
 */
function findParamsStart(fn: TsFunctionType, src: Source): number {
   const code = src.text(fn);
   // The offset is measured in the decoded text, not as a difference of byte offsets.
   const skipped = fn.typeParams
      ? src.text({ span: { ...fn.span, end: fn.typeParams.span.end } })
      : "";
   let index = skipped.length;
   while (index < code.length) {
      if (code.startsWith("/*", index)) {
         index = code.indexOf("*/", index + 2) + 2;
      } else if (code.startsWith("//", index)) {
         index = code.indexOf("\n", index) + 1;
      } else if (code[index] === "(") {
         return index + 1;
      } else {
         index++;
      }
   }
   throw new Error(`Cannot find the parameter list of the signature '${code}'`);
}

function isVoidType(node: AstNode): boolean {
   const type = unwrapTypeParentheses(node);
   return type.type === "TsKeywordType" && type.kind === "void";
}

/**
 * Tells whether a return type is `void`, `Promise<void>` (when `Promise` is the global one), or a
 * union of those, such as `Promise<void> | void` of a handler that may be async.
 */
function returnsVoid(returnNode: AstNode, globalPromise: boolean): boolean {
   const type = unwrapTypeParentheses(returnNode);
   if (type.type === "TsUnionType") {
      return (type.types as AstNode[]).every((member) => returnsVoid(member, globalPromise));
   }
   if (isVoidType(type)) {
      return true;
   }
   const args: AstNode[] = globalPromise && isPromiseType(type) ? type.typeParams?.params : [];
   return args?.length === 1 && isVoidType(args[0]);
}

/** The types whose first type argument is the type of the chunks of a `stream` channel. */
const STREAM_RETURN_TYPES = new Set(["AsyncIterable", "AsyncIterableIterator", "AsyncGenerator"]);

/**
 * The node of the type of the chunks of a `stream` channel, or null when the return type is not
 * the global `AsyncIterable<Chunk>`, `AsyncIterableIterator<Chunk>` or `AsyncGenerator<Chunk, ...>`.
 * A user type with such a name, or a qualified name, is not one of them.
 */
function getChunkNode(returnNode: AstNode, locals: ReadonlySet<string>): AstNode | null {
   const type = unwrapTypeParentheses(returnNode);
   if (
      type.type !== "TsTypeReference" ||
      type.typeName.type !== "Identifier" ||
      !STREAM_RETURN_TYPES.has(type.typeName.value) ||
      locals.has(type.typeName.value)
   ) {
      return null;
   }
   const args: AstNode[] = type.typeParams?.params ?? [];
   return args.length > 0 ? args[0] : null;
}

export function parseSignature(
   fn: TsFunctionType,
   src: Source,
   locals: ReadonlySet<string> = new Set(),
   declarations: TypeDeclarations = new Map(),
   streaming = false,
): t.CallableSignature {
   const set = new Set<string>();
   const spanRefs: SpanRef[] = [];
   collectCustomTypes(fn as AstNode, src, set, new Set(), locals, spanRefs);

   // Offsets in the decoded text of the definition, which starts at the span of the function type.
   const offsetOf = (position: number) => src.text({ span: { ...fn.span, end: position } }).length;
   const typeRefs: t.TypeRef[] = spanRefs
      .map(({ name, span, importPath }) => ({
         name,
         start: offsetOf(span.start),
         end: offsetOf(span.end),
         ...(importPath === undefined ? {} : { importPath }),
      }))
      .sort((a, b) => a.start - b.start);

   const returnNode = fn.typeAnnotation.typeAnnotation;
   const returnType = src.text(returnNode) || "void";
   const isAsync = !locals.has("Promise") && isPromiseType(returnNode as AstNode);

   const cloneIssues: t.CloneIssue[] = [];
   const walk: CloneWalk = {
      src,
      locals,
      declarations,
      where: "",
      promiseOk: false,
      awaited: false,
      active: [],
      scope: typeParamScope(fn as AstNode, new Map()),
      issues: cloneIssues,
   };
   const params = fn.params.map((param) => {
      const info = getParamInfo(param, src);
      const annotation = (param as AstNode).typeAnnotation?.typeAnnotation;
      walkCloneType(annotation, { ...walk, where: `parameter '${info.name}'` });
      return annotation ? { ...info, typeStart: offsetOf(annotation.span.start) } : info;
   });
   // What a stream sends are its chunks, one by one, not the iterable that the handler returns.
   const chunkNode = streaming ? getChunkNode(returnNode as AstNode, locals) : null;
   // The result of an async signature is the value that the Promise resolves to.
   const result: AstNode[] = chunkNode
      ? [chunkNode]
      : isAsync
        ? (unwrapTypeParentheses(returnNode as AstNode).typeParams?.params ?? [])
        : [returnNode as AstNode];
   for (const node of result) {
      walkCloneType(node, {
         ...walk,
         where: chunkNode ? "chunk type" : "return type",
         // A stream sends its chunks, not a Promise. The result of an async signature was unwrapped
         // above, so the Promise of a sync signature may only be the result itself.
         promiseOk: !(chunkNode || isAsync),
      });
   }
   return {
      definition: src.text(fn),
      paramsStart: findParamsStart(fn, src),
      params,
      customTypes: Array.from(set),
      returnType,
      returnStart: offsetOf(returnNode.span.start),
      returnsVoid: returnsVoid(returnNode as AstNode, !locals.has("Promise")),
      async: isAsync,
      typeRefs,
      ...(cloneIssues.length > 0 ? { cloneIssues } : {}),
      ...(chunkNode
         ? { chunkType: src.text(chunkNode), chunkStart: offsetOf(chunkNode.span.start) }
         : {}),
   };
}
