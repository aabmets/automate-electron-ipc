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
   ExportDeclaration,
   ExportDefaultDeclaration,
   ImportDeclaration,
   Module,
   ModuleItem,
   Param,
   Span,
   TsFunctionType,
   TsInterfaceDeclaration,
   TsTypeAliasDeclaration,
} from "@swc/core";
import { parseSync } from "@swc/core";
import type * as t from "@types";
import vld from "./validators.js";

export interface AstNode {
   type: string;
   span: Span;
   [key: string]: any;
}

export interface Source {
   text: (node: { span: Span }) => string;
}

export type TypeDefinitionNode =
   | TsInterfaceDeclaration
   | TsTypeAliasDeclaration
   | ExportDeclaration
   | ExportDefaultDeclaration;

export function parseModule(code: string): { module: Module; src: Source } {
   const module = parseSync(code, { syntax: "typescript", target: "esnext" });
   // swc spans are 1-based offsets into the source of each parse call.
   const base = 1;
   const src: Source = {
      text: (node) => code.slice(node.span.start - base, node.span.end - base),
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

export function isBuiltinType(typeName: string): boolean {
   return new Set([
      "string",
      "number",
      "boolean",
      "void",
      "any",
      "unknown",
      "null",
      "undefined",
      "never",
      "object",
      "Function",
      "Promise",
   ]).has(typeName);
}

export function collectCustomTypes(node: AstNode, src: Source, set: Set<string>): void {
   if (!node) {
      return;
   } else if (node.type === "TsTypeReference") {
      const typeName = src.text(node.typeName);
      if (!isBuiltinType(typeName)) {
         set.add(typeName);
      }
   } else if (node.type === "KeyValuePatternProperty") {
      if (node.value?.type === "Identifier" && !isBuiltinType(node.value.value)) {
         set.add(node.value.value);
      }
   } else if (node.type === "ImportDeclaration") {
      for (const element of node.specifiers) {
         const name = element.local.value;
         if (
            element.type === "ImportSpecifier" &&
            (node.typeOnly || element.isTypeOnly) &&
            !isBuiltinType(name)
         ) {
            set.add(name);
         }
      }
   }
   forEachChild(node, (child) => collectCustomTypes(child, src, set));
}

const PACKAGE_NAME = "automate-electron-ipc";

interface VerbInfo {
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   options: string[];
}

const VERBS = new Map<string, VerbInfo>([
   ["invoke", { kind: "Unicast", direction: "RendererToMain", options: [] }],
   ["send", { kind: "Broadcast", direction: "RendererToMain", options: [] }],
   ["emit", { kind: "Broadcast", direction: "MainToRenderer", options: ["trigger"] }],
   ["port", { kind: "Port", direction: "RendererToRenderer", options: [] }],
]);

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

function unwrapParentheses(node: AstNode): AstNode {
   let current = node;
   while (current.type === "ParenthesisExpression") {
      current = current.expression;
   }
   return current;
}

function unwrapTypeParentheses(node: AstNode): AstNode {
   let current = node;
   while (current.type === "TsParenthesizedType") {
      current = current.typeAnnotation;
   }
   return current;
}

function isDefineChannelsCall(node: AstNode, imports: LibraryImports): boolean {
   return (
      node.type === "CallExpression" &&
      resolveLibraryName(node.callee, imports) === "defineChannels"
   );
}

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

export function parseSignature(fn: TsFunctionType, src: Source): t.CallableSignature {
   const set = new Set<string>();
   collectCustomTypes(fn as AstNode, src, set);

   const returnType = src.text(fn.typeAnnotation.typeAnnotation) || "void";
   return {
      definition: src.text(fn),
      params: fn.params.map((param) => getParamInfo(param, src)),
      customTypes: Array.from(set),
      returnType,
      async: returnType.startsWith("Promise"),
   };
}

/**
 * Raised for channel declarations that cannot be turned into channel specs.
 * The message names the schema file and, when known, the channel.
 */
class SchemaError extends Error {
   constructor(file: string, message: string, channel?: string) {
      const where = channel === undefined ? "" : ` channel '${channel}':`;
      super(`Schema file '${file}':${where} ${message}`);
      this.name = "SchemaError";
   }
}

interface ParseContext {
   file: string;
   src: Source;
   imports: LibraryImports;
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
      const value = unwrapParentheses(prop.value);
      if (value.type !== "StringLiteral") {
         throw fail(`option '${key.value}' must be a string literal.`);
      }
      Object.assign(result, { [key.value]: value.value });
   }
   return result;
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
   if (typeArgs.length > 1) {
      throw fail(`'${verb}' takes exactly one type argument, the signature.`);
   } else if (typeArgs.length === 1 && asType) {
      throw fail(
         `the signature is given twice, as a type argument and with 'as'. ` +
            `Use only one of them.`,
      );
   }
   const signature = asType ?? (typeArgs.length === 1 ? unwrapTypeParentheses(typeArgs[0]) : null);
   if (!signature) {
      throw fail(
         `no signature. Write ${verb}<(arg: string) => void>() ` +
            `or ${verb}() as (arg: string) => void.`,
      );
   } else if (signature.type !== "TsFunctionType") {
      const text = ctx.src.text(signature as { span: Span });
      throw fail(`the signature must be a function type, found '${text}'.`);
   }
   return {
      name,
      kind: info.kind,
      direction: info.direction,
      signature: parseSignature(signature as unknown as TsFunctionType, ctx.src),
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
      const call = unwrapParentheses(item.expression);
      return isDefineChannelsCall(call, imports) ? { call, exported: { kind: "default" } } : null;
   } else if (
      item.type === "ExportDeclaration" &&
      item.declaration.type === "VariableDeclaration"
   ) {
      for (const decl of item.declaration.declarations as AstNode[]) {
         const init = decl.init ? unwrapParentheses(decl.init) : null;
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
         const expr = unwrapParentheses(item.expression);
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
      const init = decl.init ? unwrapParentheses(decl.init) : null;
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
   if (!found || found.call !== calls[0]) {
      throw new SchemaError(
         file,
         "the defineChannels call must be exported, with " +
            "'export default defineChannels({...})' or 'export const <name> = defineChannels({...})'.",
      );
   }
   const channelSpecs = parseChannelMap(found.call, { file, src, imports });
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
         if (!isBuiltinType(localName)) {
            customTypes.add(`default as ${localName}`);
         }
      } else {
         const exportedName = element.imported ? element.imported.value : null;
         if (!isBuiltinType(exportedName || localName)) {
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
   ) as TsInterfaceDeclaration | TsTypeAliasDeclaration;

   const kind = new Map([
      ["TsInterfaceDeclaration", "interface"],
      ["TsTypeAliasDeclaration", "type"],
   ]).get(node.type);

   let generics: string | null = null;
   if (node.typeParams && node.typeParams.parameters.length > 0) {
      const typeParams = node.typeParams.parameters.map((tp) => src.text(tp)).join(", ");
      generics = `<${typeParams}>`;
   }
   array.push({
      name: node.id.value,
      kind: kind as t.TypeKind,
      generics,
      isExported,
   });
}

function isTypeDefinition(node: AstNode): boolean {
   return node.type === "TsInterfaceDeclaration" || node.type === "TsTypeAliasDeclaration";
}

export function parseSpecs(fileData: t.RawFileContents): t.SpecsCollection {
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];

   let parsed: { module: Module; src: Source };
   try {
      parsed = parseModule(fileData.contents);
   } catch {
      // Files which are not valid TypeScript cannot contain channel definitions.
      return {
         typeSpecArray: [],
         channelSpecArray: [],
         importSpecArray: [],
         channelMapExport: null,
      };
   }
   const { module, src } = parsed;
   const file = fileData.fullPath || fileData.relativePath || "<unknown>";
   const { channelSpecs, channelMapExport } = parseChannelMapModule(module, src, file);

   module.body.forEach((node: ModuleItem) => {
      const item = node as AstNode;
      if (item.type === "ImportDeclaration") {
         parseImportDeclarations(item as ImportDeclaration, src, importSpecArray);
      } else if (isTypeDefinition(item)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDeclaration" && isTypeDefinition(item.declaration)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDefaultDeclaration" && isTypeDefinition(item.decl)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      }
   });

   return {
      typeSpecArray: vld.validateTypeSpecs(typeSpecArray),
      channelSpecArray: vld.validateChannelSpecs(channelSpecs),
      importSpecArray: importSpecArray.filter((item) => {
         return item.customTypes.length > 0 || item.namespace !== null;
      }),
      channelMapExport,
   };
}

export default {
   parseModule,
   forEachChild,
   isBuiltinType,
   collectCustomTypes,
   collectLibraryImports,
   parseSignature,
   parseChannelMapModule,
   parseImportDeclarations,
   parseTypeDefinitions,
   parseSpecs,
};
