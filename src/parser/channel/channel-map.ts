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

import type { Module, Span, TsFunctionType } from "@swc/core";
import type * as t from "@types";
import type { AstNode, Source, SpanRef } from "../ast.js";
import { nodeSpan, unwrapParentheses, unwrapTypeParentheses } from "../ast.js";
import { SchemaError } from "../diagnostics.js";
import { collectLibraryImports, resolveLibraryName } from "../library-imports.js";
import { collectModuleBindings, collectTypeDeclarations } from "../module-bindings.js";
import { toSchemaFailure } from "../schema-errors.js";
import { parseSignature } from "../type/signature.js";
import { collectCustomTypes } from "../type/type-references.js";
import {
   collectDefineChannelsCalls,
   findExportedMap,
   findIndirectlyExportedMap,
} from "./channel-exports.js";
import { collectImportBindings, type ParseContext, parseChannelConfig } from "./channel-options.js";
import { VERBS } from "./channel-verbs.js";

/**
 * Parses the second type argument of `invoke`, the error types of the channel. The text is kept
 * as written, and the types that it names are collected like the types of a signature, so that
 * the generated `types.ts` imports them.
 */
function parseErrors(node: AstNode, ctx: ParseContext): t.ErrorsSpec {
   const type = unwrapTypeParentheses(node);
   const set = new Set<string>();
   const spanRefs: SpanRef[] = [];
   collectCustomTypes(type, ctx.src, set, new Set(), ctx.locals, spanRefs);
   const offsetOf = (position: number) =>
      ctx.src.text({ span: { ...type.span, end: position } }).length;
   return {
      definition: ctx.src.text(type as { span: Span }),
      customTypes: Array.from(set),
      typeRefs: spanRefs
         .map(({ name, span, importPath }) => ({
            name,
            start: offsetOf(span.start),
            end: offsetOf(span.end),
            ...(importPath === undefined ? {} : { importPath }),
         }))
         .sort((a, b) => a.start - b.start),
   };
}

/**
 * Parses one `Name: verb<Sig>(config?)` or `Name: verb(config?) as Sig` property.
 */
function parseChannelProperty(prop: AstNode, ctx: ParseContext): Partial<t.ChannelSpec> {
   if (prop.type === "SpreadElement") {
      throw new SchemaError(
         ctx.file,
         "spread elements are not allowed in a channel map.",
         undefined,
         { span: nodeSpan(prop), src: ctx.src },
      );
   }
   const key = prop.type === "KeyValueProperty" ? prop.key : null;
   if (key?.type !== "Identifier") {
      throw new SchemaError(
         ctx.file,
         `channel names must be plain identifier keys, found a ${prop.type}.`,
         undefined,
         { span: nodeSpan(prop), src: ctx.src },
      );
   }
   const name: string = key.value;
   const fail = (message: string, node: AstNode = prop) =>
      new SchemaError(ctx.file, message, name, { span: nodeSpan(node), src: ctx.src });

   let value = unwrapParentheses(prop.value);
   let asType: AstNode | null = null;
   if (value.type === "TsAsExpression") {
      asType = unwrapTypeParentheses(value.typeAnnotation);
      value = unwrapParentheses(value.expression);
   }
   if (value.type === "ObjectExpression") {
      throw fail("nested objects are not supported in a channel map.", value);
   } else if (value.type !== "CallExpression") {
      throw fail(`expected a call to one of: ${Array.from(VERBS.keys()).join(", ")}.`, value);
   }
   const verb = resolveLibraryName(value.callee, ctx.imports);
   const info = verb ? VERBS.get(verb) : undefined;
   if (!(verb && info)) {
      const callee = ctx.src.text(value.callee);
      throw fail(
         `unknown verb '${callee}'. Use one of: ${Array.from(VERBS.keys()).join(", ")}.`,
         value.callee,
      );
   }

   const config = parseChannelConfig(value, verb, info, name, ctx);
   const typeArgs: AstNode[] = value.typeArguments?.params ?? [];
   const maxTypeArgs = info.errors ? 2 : 1;
   if (typeArgs.length > maxTypeArgs) {
      throw fail(
         info.errors
            ? `'${verb}' takes at most two type arguments, the signature and the error types.`
            : `'${verb}' takes exactly one type argument, the signature.`,
         value.typeArguments,
      );
   } else if (typeArgs.length > 0 && asType) {
      throw fail(
         `the signature is given twice, as a type argument and with 'as'. ` +
            `Use only one of them. Error types need the type argument form.`,
         asType,
      );
   }
   const signature = asType ?? (typeArgs.length > 0 ? unwrapTypeParentheses(typeArgs[0]) : null);
   if (!signature) {
      throw fail(
         `no signature. Write ${verb}<(arg: string) => void>() ` +
            `or ${verb}() as (arg: string) => void.`,
         value,
      );
   } else if (signature.type !== "TsFunctionType") {
      const text = ctx.src.text(signature as { span: Span });
      throw fail(`the signature must be a function type, found '${text}'.`, signature);
   } else if (
      (signature.params as AstNode[]).some((p) => p.type === "Identifier" && p.value === "this")
   ) {
      throw fail(
         "a 'this' parameter is not supported, since IPC does not transfer 'this'.",
         signature,
      );
   }
   const parsed = parseSignature(
      signature as unknown as TsFunctionType,
      ctx.src,
      ctx.locals,
      ctx.declarations,
      info.kind === "Stream",
   );
   if (info.kind === "Stream" && parsed.chunkType === undefined) {
      throw fail(
         `the signature of '${verb}' must return AsyncIterable<Chunk>, AsyncIterableIterator<Chunk> ` +
            `or AsyncGenerator<Chunk>, found '${parsed.returnType}'.`,
         signature,
      );
   }
   return {
      name,
      loc: ctx.src.position(key.span),
      kind: info.kind,
      direction: info.direction,
      signature: parsed,
      ...(typeArgs.length === 2 ? { errors: parseErrors(typeArgs[1], ctx) } : {}),
      ...config,
   };
}

function parseChannelMap(call: AstNode, ctx: ParseContext): Partial<t.ChannelSpec>[] {
   const arg = call.arguments[0];
   const map =
      call.arguments.length === 1 && !arg.spread ? unwrapParentheses(arg.expression) : null;
   if (map?.type !== "ObjectExpression") {
      throw new SchemaError(ctx.file, "defineChannels accepts one object literal.", undefined, {
         span: call.span,
         src: ctx.src,
      });
   }
   const specs: Partial<t.ChannelSpec>[] = [];
   const failures: SchemaError[] = [];
   for (const prop of map.properties as AstNode[]) {
      // An error in one channel does not stop the others from being checked.
      try {
         specs.push(parseChannelProperty(prop, ctx));
      } catch (error) {
         if (!(error instanceof SchemaError)) {
            throw error;
         }
         failures.push(error);
      }
   }
   if (failures.length > 0) {
      throw toSchemaFailure(failures);
   }
   return specs;
}

/**
 * Parses the channel map of a schema module: the single exported `defineChannels` call.
 * Throws a `SchemaError` that names the file (and the channel) for invalid declarations, or a
 * `SchemaErrors` with all of them when several channels are invalid.
 */
export function parseChannelMapModule(
   module: Module,
   src: Source,
   file: string,
): { channelSpecs: Partial<t.ChannelSpec>[]; channelMapExport: t.ChannelMapExport | null } {
   const imports = collectLibraryImports(module);
   const body = module.body as AstNode[];

   const calls: AstNode[] = [];
   collectDefineChannelsCalls(module as unknown as AstNode, imports, calls);
   if (calls.length === 0) {
      return { channelSpecs: [], channelMapExport: null };
   } else if (calls.length > 1) {
      throw new SchemaError(file, "only one defineChannels call is allowed per file.", undefined, {
         span: calls[1].span,
         src,
      });
   }
   const found =
      body.map((item) => findExportedMap(item, imports)).find((map) => map !== null) ??
      findIndirectlyExportedMap(body, imports);
   const exportAssignment = body.find((item) => item.type === "TsExportAssignment");
   if (!found && exportAssignment) {
      // `export = X` makes the module the value of X, which has no name for the generated files
      // to import. It is a CommonJS form of `export default`.
      throw new SchemaError(
         file,
         "'export =' is not supported in a schema file. " +
            "Export the channels with 'export default defineChannels({...})' or " +
            "'export const <name> = defineChannels({...})'.",
         undefined,
         { span: exportAssignment.span, src },
      );
   }
   if (!found || found.call !== calls[0]) {
      throw new SchemaError(
         file,
         "the defineChannels call must be exported, with " +
            "'export default defineChannels({...})' or 'export const <name> = defineChannels({...})'.",
         undefined,
         { span: calls[0].span, src },
      );
   }
   const locals = collectModuleBindings(module);
   const channelSpecs = parseChannelMap(found.call, {
      file,
      src,
      declarations: collectTypeDeclarations(module),
      imports,
      importBindings: collectImportBindings(module),
      locals,
   });
   return { channelSpecs, channelMapExport: found.exported };
}
