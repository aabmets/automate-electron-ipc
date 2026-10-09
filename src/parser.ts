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

import type { ImportDeclaration, Module, ModuleItem, Span, TsFunctionType } from "@swc/core";
import type * as t from "@types";
import type { AstNode, Source, SpanRef, TypeDefinitionNode } from "./ast.js";
import {
   forEachChild,
   parseModule,
   unwrapExpression,
   unwrapParentheses,
   unwrapTypeParentheses,
} from "./ast.js";
import { KEYWORD_TYPES } from "./builtin-types.js";
import { SchemaError, SchemaSyntaxError } from "./diagnostics.js";
import {
   collectModuleBindings,
   collectTypeDeclarations,
   declarationOf,
   isTypeDefinition,
   TYPE_KINDS,
   type TypeDeclarations,
} from "./module-bindings.js";
import { parseSignature } from "./signature.js";
import { collectCustomTypes } from "./type-references.js";
import vld from "./validators.js";

const PACKAGE_NAME = "automate-electron-ipc";

interface VerbInfo {
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   options: string[];
   /** Whether the verb takes the error types as a second type argument. */
   errors?: boolean;
}

const VERBS = new Map<string, VerbInfo>([
   [
      "invoke",
      {
         kind: "Unicast",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "send",
      {
         kind: "Broadcast",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "scopes"],
      },
   ],
   ["emit", { kind: "Broadcast", direction: "MainToRenderer", options: ["trigger", "scopes"] }],
   ["ask", { kind: "Unicast", direction: "MainToRenderer", options: ["scopes"] }],
   [
      "stream",
      {
         kind: "Stream",
         direction: "RendererToMain",
         options: ["allowedOrigins", "validate", "highWaterMark", "scopes"],
         errors: true,
      },
   ],
   ["port", { kind: "Port", direction: "RendererToRenderer", options: ["maxQueue", "scopes"] }],
   ["mainPort", { kind: "Port", direction: "MainToRenderer", options: ["maxQueue", "scopes"] }],
   ["callUtility", { kind: "Unicast", direction: "MainToUtility", options: ["timeoutMs"] }],
   ["notifyUtility", { kind: "Broadcast", direction: "MainToUtility", options: [] }],
   ["callMain", { kind: "Unicast", direction: "UtilityToMain", options: ["timeoutMs"] }],
   ["notifyMain", { kind: "Broadcast", direction: "UtilityToMain", options: [] }],
   [
      "invokeUtility",
      {
         kind: "Unicast",
         direction: "RendererToUtility",
         options: ["timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "streamUtility",
      {
         kind: "Stream",
         direction: "RendererToUtility",
         options: ["highWaterMark", "timeoutMs", "scopes"],
         errors: true,
      },
   ],
   [
      "invokeFromWorker",
      {
         kind: "Unicast",
         direction: "ServiceWorkerToMain",
         options: ["allowedOrigins", "validate", "timeoutMs"],
         errors: true,
      },
   ],
   [
      "sendFromWorker",
      {
         kind: "Broadcast",
         direction: "ServiceWorkerToMain",
         options: ["allowedOrigins", "validate"],
      },
   ],
   ["askWorker", { kind: "Unicast", direction: "MainToServiceWorker", options: [] }],
   ["emitToWorker", { kind: "Broadcast", direction: "MainToServiceWorker", options: [] }],
]);

/** The options whose value is an array of string literals. The others are string literals. */
const ARRAY_OPTIONS = new Set(["allowedOrigins", "scopes"]);

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
function resolveLibraryName(callee: AstNode, imports: LibraryImports): string | null {
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

function isDefineChannelsCall(node: AstNode, imports: LibraryImports): boolean {
   return (
      node.type === "CallExpression" &&
      resolveLibraryName(node.callee, imports) === "defineChannels"
   );
}

/** What an import declaration of the schema file binds to a local name. */
interface ImportBinding {
   /** The exported name, `"default"` for a default import, or `"*"` for a namespace import. */
   exported: string;
   fromPath: string;
   typeOnly: boolean;
}

/** The imports of a module by local name. */
function collectImportBindings(module: Module): Map<string, ImportBinding> {
   const bindings = new Map<string, ImportBinding>();
   for (const item of module.body as AstNode[]) {
      if (item.type !== "ImportDeclaration") {
         continue;
      }
      for (const element of item.specifiers as AstNode[]) {
         const exported =
            element.type === "ImportDefaultSpecifier"
               ? "default"
               : element.type === "ImportNamespaceSpecifier"
                 ? "*"
                 : (element.imported?.value ?? element.local.value);
         bindings.set(element.local.value, {
            exported,
            fromPath: item.source.value,
            typeOnly: !!item.typeOnly || !!element.isTypeOnly,
         });
      }
   }
   return bindings;
}

interface ParseContext {
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
   fail: (message: string) => Error,
   ctx: ParseContext,
): t.ValidatorRef {
   if (value.type !== "Identifier") {
      throw fail("option 'validate' must be an identifier which the schema file imports.");
   }
   const binding = ctx.importBindings.get(value.value);
   if (!binding) {
      throw fail(
         `option 'validate' refers to '${value.value}', which is not imported in the schema file. ` +
            "Import the schema from another module.",
      );
   } else if (binding.typeOnly) {
      throw fail(
         `option 'validate' refers to '${value.value}', which is a type-only import. ` +
            "Import it as a value.",
      );
   } else if (binding.exported === "*") {
      throw fail(
         `option 'validate' refers to '${value.value}', a namespace import. ` +
            "Import the schema itself, such as `import { schema } from '...'`.",
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
   fail: (message: string) => Error,
   src: Source,
): number {
   const expected = `option '${option}' must be a non-negative integer literal or Infinity`;
   if (value.type === "Identifier" && value.value === "Infinity") {
      return Number.POSITIVE_INFINITY;
   } else if (value.type !== "NumericLiteral") {
      throw fail(`${expected}, found '${src.text(value as { span: Span })}'.`);
   } else if (!Number.isInteger(value.value)) {
      throw fail(`${expected}, found '${value.value}'.`);
   } else if (!Number.isSafeInteger(value.value)) {
      throw fail(`option '${option}' cannot exceed ${Number.MAX_SAFE_INTEGER}. Use Infinity.`);
   }
   return value.value;
}

/**
 * Resolves the `timeoutMs` option: a non-negative integer literal.
 */
function parseTimeoutMs(value: AstNode, fail: (message: string) => Error, src: Source): number {
   const expected = "option 'timeoutMs' must be a non-negative integer literal";
   if (value.type !== "NumericLiteral") {
      throw fail(`${expected}, found '${src.text(value as { span: Span })}'.`);
   } else if (!Number.isInteger(value.value)) {
      throw fail(`${expected}, found '${value.value}'.`);
   } else if (!Number.isSafeInteger(value.value)) {
      throw fail(`option 'timeoutMs' cannot exceed ${Number.MAX_SAFE_INTEGER}.`);
   }
   return value.value;
}

/**
 * Parses the value of one config option, as the entry of the config that it sets.
 */
function parseOption(
   key: string,
   value: AstNode,
   fail: (message: string) => Error,
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
         throw fail(`option '${key}' must be an array of string literals.`);
      }
      return { [key]: literals.map((literal) => literal?.value) };
   } else if (value.type !== "StringLiteral") {
      throw fail(`option '${key}' must be a string literal.`);
   }
   return { [key]: value.value };
}

function parseChannelConfig(
   call: AstNode,
   verb: string,
   info: VerbInfo,
   name: string,
   ctx: ParseContext,
): Partial<t.ChannelSpec> {
   const fail = (message: string) => new SchemaError(ctx.file, message, name);
   const result: Partial<t.ChannelSpec> = {};
   if (call.arguments.length === 0) {
      return result;
   }
   const arg = call.arguments[0];
   const config = arg.spread ? null : unwrapParentheses(arg.expression);
   if (call.arguments.length > 1 || config?.type !== "ObjectExpression") {
      throw fail(`'${verb}' accepts one optional config object literal.`);
   }
   for (const prop of config.properties as AstNode[]) {
      const key = prop.type === "KeyValueProperty" ? prop.key : null;
      if (key?.type !== "Identifier") {
         throw fail(`'${verb}' config keys must be plain identifiers.`);
      }
      if (!info.options.includes(key.value)) {
         throw fail(`option '${key.value}' is not supported by '${verb}'.`);
      }
      Object.assign(result, parseOption(key.value, unwrapParentheses(prop.value), fail, ctx));
   }
   return result;
}

/**
 * Parses the second type argument of `invoke`, the error types of the channel. The text is kept
 * as written, and the types that it names are collected like the types of a signature, so that
 * the generated `window.d.ts` imports them.
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
      throw new SchemaError(ctx.file, "spread elements are not allowed in a channel map.");
   }
   const key = prop.type === "KeyValueProperty" ? prop.key : null;
   if (key?.type !== "Identifier") {
      throw new SchemaError(
         ctx.file,
         `channel names must be plain identifier keys, found a ${prop.type}.`,
      );
   }
   const name: string = key.value;
   const fail = (message: string) => new SchemaError(ctx.file, message, name);

   let value = unwrapParentheses(prop.value);
   let asType: AstNode | null = null;
   if (value.type === "TsAsExpression") {
      asType = unwrapTypeParentheses(value.typeAnnotation);
      value = unwrapParentheses(value.expression);
   }
   if (value.type === "ObjectExpression") {
      throw fail("nested objects are not supported in a channel map.");
   } else if (value.type !== "CallExpression") {
      throw fail(`expected a call to one of: ${Array.from(VERBS.keys()).join(", ")}.`);
   }
   const verb = resolveLibraryName(value.callee, ctx.imports);
   const info = verb ? VERBS.get(verb) : undefined;
   if (!(verb && info)) {
      const callee = ctx.src.text(value.callee);
      throw fail(`unknown verb '${callee}'. Use one of: ${Array.from(VERBS.keys()).join(", ")}.`);
   }

   const config = parseChannelConfig(value, verb, info, name, ctx);
   const typeArgs: AstNode[] = value.typeArguments?.params ?? [];
   const maxTypeArgs = info.errors ? 2 : 1;
   if (typeArgs.length > maxTypeArgs) {
      throw fail(
         info.errors
            ? `'${verb}' takes at most two type arguments, the signature and the error types.`
            : `'${verb}' takes exactly one type argument, the signature.`,
      );
   } else if (typeArgs.length > 0 && asType) {
      throw fail(
         `the signature is given twice, as a type argument and with 'as'. ` +
            `Use only one of them. Error types need the type argument form.`,
      );
   }
   const signature = asType ?? (typeArgs.length > 0 ? unwrapTypeParentheses(typeArgs[0]) : null);
   if (!signature) {
      throw fail(
         `no signature. Write ${verb}<(arg: string) => void>() ` +
            `or ${verb}() as (arg: string) => void.`,
      );
   } else if (signature.type !== "TsFunctionType") {
      const text = ctx.src.text(signature as { span: Span });
      throw fail(`the signature must be a function type, found '${text}'.`);
   } else if (
      (signature.params as AstNode[]).some((p) => p.type === "Identifier" && p.value === "this")
   ) {
      throw fail("a 'this' parameter is not supported, since IPC does not transfer 'this'.");
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
      );
   }
   return {
      name,
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
      throw new SchemaError(ctx.file, "defineChannels accepts one object literal.");
   }
   return (map.properties as AstNode[]).map((prop) => parseChannelProperty(prop, ctx));
}

interface ExportedMap {
   call: AstNode;
   exported: t.ChannelMapExport;
}

/**
 * Finds the `defineChannels` call that a module-level statement exports, if any.
 */
function findExportedMap(item: AstNode, imports: LibraryImports): ExportedMap | null {
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
      if (item.type === "ExportDefaultExpression") {
         const expr = unwrapExpression(item.expression);
         if (expr.type === "Identifier" && expr.value === local) {
            return { kind: "default" };
         }
      } else if (item.type === "ExportNamedDeclaration" && !item.source) {
         const spec = (item.specifiers as AstNode[]).find(
            (s) => s.type === "ExportSpecifier" && s.orig.value === local,
         );
         if (spec) {
            const name: string = spec.exported?.value ?? local;
            return name === "default" ? { kind: "default" } : { kind: "named", name };
         }
      }
   }
   return null;
}

/**
 * Finds a `const m = defineChannels(...)` that is exported later through
 * `export default m` or `export { m }`.
 */
function findIndirectlyExportedMap(body: AstNode[], imports: LibraryImports): ExportedMap | null {
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

function collectDefineChannelsCalls(node: AstNode, imports: LibraryImports, out: AstNode[]): void {
   if (isDefineChannelsCall(node, imports)) {
      out.push(node);
   }
   forEachChild(node, (child) => collectDefineChannelsCalls(child, imports, out));
}

/**
 * Parses the channel map of a schema module: the single exported `defineChannels` call.
 * Throws a `SchemaError` that names the file (and the channel) for invalid declarations.
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
      throw new SchemaError(file, "only one defineChannels call is allowed per file.");
   }
   const found =
      body.map((item) => findExportedMap(item, imports)).find((map) => map !== null) ??
      findIndirectlyExportedMap(body, imports);
   if (!found && body.some((item) => item.type === "TsExportAssignment")) {
      // `export = X` makes the module the value of X, which has no name for the generated files
      // to import. It is a CommonJS form of `export default`.
      throw new SchemaError(
         file,
         "'export =' is not supported in a schema file. " +
            "Export the channels with 'export default defineChannels({...})' or " +
            "'export const <name> = defineChannels({...})'.",
      );
   }
   if (!found || found.call !== calls[0]) {
      throw new SchemaError(
         file,
         "the defineChannels call must be exported, with " +
            "'export default defineChannels({...})' or 'export const <name> = defineChannels({...})'.",
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

/**
 * Records the names that an import declaration binds, as the entries of `customTypes`:
 * `Foo` for `{ Foo }`, `Foo as Bar` for `{ Foo as Bar }` and `default as Foo` for `Foo`.
 * Value imports are recorded too, since a signature may use a class or an enum as a type.
 * The writers emit only the ones that a channel signature references, as `import type`.
 */
export function parseImportDeclarations(
   node: ImportDeclaration,
   _src: Source,
   array: t.ImportSpec[],
): void {
   const customTypes = new Set<string>();
   const importSpec: t.ImportSpec = {
      fromPath: node.source.value,
      customTypes: [],
      namespace: null,
   };
   for (const element of node.specifiers) {
      const localName = element.local.value;
      if (element.type === "ImportNamespaceSpecifier") {
         importSpec.namespace = localName;
      } else if (element.type === "ImportDefaultSpecifier") {
         if (!KEYWORD_TYPES.has(localName)) {
            customTypes.add(`default as ${localName}`);
         }
      } else {
         const exportedName = element.imported ? element.imported.value : null;
         // An import takes precedence over a global of the same name, such as `Error`.
         if (!KEYWORD_TYPES.has(exportedName || localName)) {
            customTypes.add(
               exportedName && exportedName !== localName
                  ? `${exportedName} as ${localName}`
                  : localName,
            );
         }
      }
   }
   importSpec.customTypes = Array.from(customTypes);
   if (node.specifiers.length > 0) {
      array.push(importSpec);
   }
}

/** The dotted text of an entity name: `Models.User` for `Models.User`. */
function entityNameText(name: AstNode): string {
   return name.type === "TsQualifiedName"
      ? `${entityNameText(name.left)}.${name.right.value}`
      : name.value;
}

/**
 * Records the name that `import X = Ns.Y` or `import X = require("./m")` declares. An exported
 * alias is a declaration of the schema file, which the generated files import from it, like
 * `export type X = ...`. One that is not exported is not visible outside of the schema file, so
 * the generated files resolve it to its target: `Ns.Y` for the first form, and for the second
 * the namespace import `import * as X from "./m"`.
 */
export function parseImportEquals(
   item: AstNode,
   importSpecs: t.ImportSpec[],
   typeSpecs: t.TypeSpec[],
): void {
   const name: string = item.id.value;
   const moduleRef = item.moduleRef as AstNode;
   const isRequire = moduleRef.type === "TsExternalModuleReference";
   if (item.isExport) {
      typeSpecs.push({ name, kind: "alias", generics: null, isExported: true });
   } else if (isRequire) {
      importSpecs.push({ fromPath: moduleRef.expression.value, customTypes: [], namespace: name });
   } else {
      typeSpecs.push({
         name,
         kind: "alias",
         generics: null,
         isExported: false,
         aliasOf: entityNameText(moduleRef),
      });
   }
}

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

function isValueDefinition(node: AstNode): boolean {
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
   const node = (
      item.type === "ExportDeclaration"
         ? item.declaration
         : item.type === "ExportDefaultDeclaration"
           ? item.decl
           : item
   ) as AstNode;

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

export function parseSpecs(fileData: t.RawFileContents): t.SpecsCollection {
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];

   const file = fileData.fullPath || fileData.relativePath || "<unknown>";
   let parsed: { module: Module; src: Source };
   try {
      parsed = parseModule(fileData.contents);
   } catch (error) {
      throw new SchemaSyntaxError(file, error, fileData.contents);
   }
   const { module, src } = parsed;
   const { channelSpecs, channelMapExport } = parseChannelMapModule(module, src, file);

   module.body.forEach((node: ModuleItem) => {
      const item = node as AstNode;
      if (item.type === "ImportDeclaration") {
         parseImportDeclarations(item as ImportDeclaration, src, importSpecArray);
      } else if (item.type === "TsImportEqualsDeclaration") {
         parseImportEquals(item, importSpecArray, typeSpecArray);
      } else if (isTypeDefinition(item)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDeclaration" && isTypeDefinition(item.declaration)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDefaultDeclaration" && isTypeDefinition(item.decl)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (isValueDefinition(declarationOf(item))) {
         parseValueDefinitions(item, typeSpecArray);
      }
   });

   applyExportSpecifiers(module.body as AstNode[], typeSpecArray);

   const channelSpecArray = vld.validateChannelSpecs(channelSpecs, file);
   return {
      typeSpecArray: vld.validateTypeSpecs(typeSpecArray, channelSpecArray),
      channelSpecArray,
      importSpecArray: importSpecArray.filter((item) => {
         return item.customTypes.length > 0 || item.namespace !== null;
      }),
      channelMapExport,
   };
}

export default {
   collectLibraryImports,
   parseChannelMapModule,
   parseImportDeclarations,
   parseImportEquals,
   parseTypeDefinitions,
   parseValueDefinitions,
   applyExportSpecifiers,
   parseSpecs,
};
