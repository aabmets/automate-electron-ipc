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

import type { Module, Span } from "@swc/core";
import type * as t from "@types";
import type { AstNode, Source } from "../ast.js";
import { nodeSpan, unwrapParentheses } from "../ast.js";
import { SchemaError } from "../diagnostics.js";
import type { LibraryImports } from "../library-imports.js";
import type { TypeDeclarations } from "../module-bindings.js";
import { ARRAY_OPTIONS, type VerbInfo } from "./channel-verbs.js";

/** What an import declaration of the schema file binds to a local name. */
interface ImportBinding {
   /** The exported name, `"default"` for a default import, or `"*"` for a namespace import. */
   exported: string;
   fromPath: string;
   typeOnly: boolean;
}

/** The imports of a module by local name. */
export function collectImportBindings(module: Module): Map<string, ImportBinding> {
   const bindings = new Map<string, ImportBinding>();
   for (const item of module.body as AstNode[]) {
      if (item.type !== "ImportDeclaration") {
         continue;
      }
      for (const element of item.specifiers as AstNode[]) {
         let exported: string = element.imported?.value ?? element.local.value;
         if (element.type === "ImportDefaultSpecifier") {
            exported = "default";
         } else if (element.type === "ImportNamespaceSpecifier") {
            exported = "*";
         }
         bindings.set(element.local.value, {
            exported,
            fromPath: item.source.value,
            typeOnly: !!item.typeOnly || !!element.isTypeOnly,
         });
      }
   }
   return bindings;
}

export interface ParseContext {
   file: string;
   src: Source;
   /** The aliases, interfaces and classes of the schema file, see `collectTypeDeclarations`. */
   declarations: TypeDeclarations;
   imports: LibraryImports;
   /** The imports of the schema file by local name, which `validate` refers to. */
   importBindings: ReadonlyMap<string, ImportBinding>;
   /** The names that the schema file binds at module level, see `collectModuleBindings`. */
   locals: ReadonlySet<string>;
}

/**
 * Resolves the `validate` option to the import that it names. The generated main bindings
 * import the validator as a value, so it must be a named or default value import of the schema
 * file: a type-only import has no runtime value, a namespace import is not a schema, and a
 * local declaration cannot be imported from a schema file, since it also declares the channels.
 */
function parseValidatorRef(
   value: AstNode,
   fail: (message: string, node?: AstNode) => Error,
   ctx: ParseContext,
): t.ValidatorRef {
   if (value.type !== "Identifier") {
      throw fail("option 'validate' must be an identifier which the schema file imports.", value);
   }
   const binding = ctx.importBindings.get(value.value);
   if (!binding) {
      throw fail(
         `option 'validate' refers to '${value.value}', which is not imported in the schema file. ` +
            "Import the schema from another module.",
         value,
      );
   } else if (binding.typeOnly) {
      throw fail(
         `option 'validate' refers to '${value.value}', which is a type-only import. ` +
            "Import it as a value.",
         value,
      );
   } else if (binding.exported === "*") {
      throw fail(
         `option 'validate' refers to '${value.value}', a namespace import. ` +
            "Import the schema itself, such as `import { schema } from '...'`.",
         value,
      );
   }
   return { name: value.value, exported: binding.exported, fromPath: binding.fromPath };
}

/**
 * Resolves the `maxQueue` or `highWaterMark` option: a non-negative integer literal, or the
 * global `Infinity`.
 */
function parseCountLimit(
   option: string,
   value: AstNode,
   fail: (message: string, node?: AstNode) => Error,
   src: Source,
): number {
   const expected = `option '${option}' must be a non-negative integer literal or Infinity`;
   if (value.type === "Identifier" && value.value === "Infinity") {
      return Number.POSITIVE_INFINITY;
   } else if (value.type !== "NumericLiteral") {
      throw fail(`${expected}, found '${src.text(value as { span: Span })}'.`, value);
   } else if (!Number.isInteger(value.value)) {
      throw fail(`${expected}, found '${value.value}'.`, value);
   } else if (!Number.isSafeInteger(value.value)) {
      throw fail(
         `option '${option}' cannot exceed ${Number.MAX_SAFE_INTEGER}. Use Infinity.`,
         value,
      );
   }
   return value.value;
}

/**
 * Resolves the `timeoutMs` option: a non-negative integer literal.
 */
function parseTimeoutMs(
   value: AstNode,
   fail: (message: string, node?: AstNode) => Error,
   src: Source,
): number {
   const expected = "option 'timeoutMs' must be a non-negative integer literal";
   if (value.type !== "NumericLiteral") {
      throw fail(`${expected}, found '${src.text(value as { span: Span })}'.`, value);
   } else if (!Number.isInteger(value.value)) {
      throw fail(`${expected}, found '${value.value}'.`, value);
   } else if (!Number.isSafeInteger(value.value)) {
      throw fail(`option 'timeoutMs' cannot exceed ${Number.MAX_SAFE_INTEGER}.`, value);
   }
   return value.value;
}

/**
 * Parses the value of one config option, as the entry of the config that it sets.
 */
function parseOption(
   key: string,
   value: AstNode,
   fail: (message: string, node?: AstNode) => Error,
   ctx: ParseContext,
): Partial<t.ChannelSpec> {
   if (key === "validate") {
      return { validate: parseValidatorRef(value, fail, ctx) };
   } else if (key === "maxQueue" || key === "highWaterMark") {
      return { [key]: parseCountLimit(key, value, fail, ctx.src) };
   } else if (key === "timeoutMs") {
      return { timeoutMs: parseTimeoutMs(value, fail, ctx.src) };
   } else if (ARRAY_OPTIONS.has(key)) {
      const elements: (AstNode | undefined)[] =
         value.type === "ArrayExpression" ? value.elements : [];
      const literals = elements.map((element) =>
         !element || element.spread ? null : unwrapParentheses(element.expression),
      );
      if (
         value.type !== "ArrayExpression" ||
         literals.some((literal) => literal?.type !== "StringLiteral")
      ) {
         throw fail(`option '${key}' must be an array of string literals.`, value);
      }
      return { [key]: literals.map((literal) => literal?.value) };
   } else if (value.type !== "StringLiteral") {
      throw fail(`option '${key}' must be a string literal.`, value);
   }
   return { [key]: value.value };
}

export function parseChannelConfig(
   call: AstNode,
   verb: string,
   info: VerbInfo,
   name: string,
   ctx: ParseContext,
): Partial<t.ChannelSpec> {
   const fail = (message: string, node: AstNode = call) =>
      new SchemaError(ctx.file, message, name, { span: nodeSpan(node), src: ctx.src });
   const result: Partial<t.ChannelSpec> = {};
   if (call.arguments.length === 0) {
      return result;
   }
   const arg = call.arguments[0];
   const config = arg.spread ? null : unwrapParentheses(arg.expression);
   if (call.arguments.length > 1 || config?.type !== "ObjectExpression") {
      throw fail(`'${verb}' accepts one optional config object literal.`, config ?? arg.expression);
   }
   for (const prop of config.properties as AstNode[]) {
      const key = prop.type === "KeyValueProperty" ? prop.key : null;
      if (key?.type !== "Identifier") {
         throw fail(`'${verb}' config keys must be plain identifiers.`, prop);
      }
      if (!info.options.includes(key.value)) {
         throw fail(`option '${key.value}' is not supported by '${verb}'.`, key);
      }
      Object.assign(result, parseOption(key.value, unwrapParentheses(prop.value), fail, ctx));
   }
   return result;
}
