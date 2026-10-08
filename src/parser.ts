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
   ImportDeclaration,
   Module,
   ModuleItem,
   Param,
   Span,
   TsEnumDeclaration,
   TsFunctionType,
   TsInterfaceDeclaration,
   TsModuleDeclaration,
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

/** A reference to a type by name, with the swc span of the identifier. */
export interface SpanRef {
   name: string;
   span: Span;
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
   const module = parseSync(code, { syntax: "typescript", target: "esnext" });
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

/** Type keywords. They cannot be declared or imported, so no local name takes their place. */
const KEYWORD_TYPES = new Set([
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
]);

const BUILTIN_TYPES = new Set([
   ...KEYWORD_TYPES,
   // Global types that signatures use without an import.
   "Function",
   "Promise",
   // ECMAScript globals.
   "Array",
   "ReadonlyArray",
   "Map",
   "ReadonlyMap",
   "Set",
   "ReadonlySet",
   "WeakMap",
   "WeakSet",
   "WeakRef",
   "Date",
   "RegExp",
   "Error",
   "ArrayBuffer",
   "SharedArrayBuffer",
   "DataView",
   "Int8Array",
   "Uint8Array",
   "Uint8ClampedArray",
   "Int16Array",
   "Uint16Array",
   "Int32Array",
   "Uint32Array",
   "Float32Array",
   "Float64Array",
   "BigInt64Array",
   "BigUint64Array",
   "Iterable",
   "Iterator",
   "AsyncIterable",
   "AsyncIterator",
   "Generator",
   "AsyncGenerator",
   "PromiseLike",
   "ArrayLike",
   // Utility types.
   "Record",
   "Partial",
   "Required",
   "Readonly",
   "Pick",
   "Omit",
   "Exclude",
   "Extract",
   "NonNullable",
   "ReturnType",
   "Parameters",
   "InstanceType",
   "ConstructorParameters",
   "Awaited",
   "Uppercase",
   "Lowercase",
   "Capitalize",
   "Uncapitalize",
   // Global namespaces, such as `Intl.DateTimeFormat`.
   "Intl",
]);

/**
 * Tells whether a name stands for a type keyword or a global type, which every generated file
 * has without an import. A name that the schema file binds itself, by declaring or importing it,
 * is not a global: `locals` are such names, and they take precedence over the global list.
 */
export function isBuiltinType(typeName: string, locals?: ReadonlySet<string>): boolean {
   return KEYWORD_TYPES.has(typeName) || (BUILTIN_TYPES.has(typeName) && !locals?.has(typeName));
}

/**
 * The names that a schema file binds at module level and may use as types: every import
 * (named, default and namespace) and every interface, type alias, enum, namespace and class.
 */
export function collectModuleBindings(module: Module): Set<string> {
   const names = new Set<string>();
   for (const node of module.body) {
      const item = node as AstNode;
      if (item.type === "ImportDeclaration") {
         for (const element of item.specifiers as AstNode[]) {
            names.add(element.local.value);
         }
         continue;
      }
      const declaration =
         item.type === "ExportDeclaration"
            ? item.declaration
            : item.type === "ExportDefaultDeclaration"
              ? item.decl
              : item;
      if (isTypeDefinition(declaration)) {
         names.add((declaration.id ?? declaration.identifier).value);
      }
   }
   return names;
}

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
   if (node.type === "TsTypeReference") {
      // A qualified name such as `Kind.A` is kept whole. Its head is resolved by the writers.
      const typeName = src.text(node.typeName);
      const head = headOf(typeName);
      if (!(isBuiltinType(head, locals) || inScope.has(head))) {
         set.add(typeName);
         const identifier = headNode(node.typeName);
         if (identifier) {
            refs?.push({ name: head, span: identifier.span });
         }
      }
   } else if (node.type === "TsTypeQuery") {
      const identifier = headNode(node.exprName);
      if (identifier && !inScope.has(identifier.value)) {
         set.add(identifier.value);
         refs?.push({ name: identifier.value, span: identifier.span });
      }
   } else if (node.type === "ImportDeclaration") {
      for (const element of node.specifiers) {
         const name = element.local.value;
         if (element.type === "ImportSpecifier" && (node.typeOnly || element.isTypeOnly)) {
            set.add(name);
         }
      }
   }
   forEachChild(node, (child) => collectCustomTypes(child, src, set, inScope, locals, refs));
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
function unwrapExpression(node: AstNode): AstNode {
   let current = node;
   while (EXPRESSION_WRAPPERS.has(current.type)) {
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

/** Tells whether a return type is `void` or, for an async signature, `Promise<void>`. */
function returnsVoid(returnNode: AstNode, isAsync: boolean): boolean {
   if (isVoidType(returnNode)) {
      return true;
   }
   const args: AstNode[] = isAsync ? unwrapTypeParentheses(returnNode).typeParams?.params : [];
   return args?.length === 1 && isVoidType(args[0]);
}

export function parseSignature(
   fn: TsFunctionType,
   src: Source,
   locals: ReadonlySet<string> = new Set(),
): t.CallableSignature {
   const set = new Set<string>();
   const spanRefs: SpanRef[] = [];
   collectCustomTypes(fn as AstNode, src, set, new Set(), locals, spanRefs);

   // Offsets in the decoded text of the definition, which starts at the span of the function type.
   const offsetOf = (position: number) => src.text({ span: { ...fn.span, end: position } }).length;
   const typeRefs: t.TypeRef[] = spanRefs
      .map(({ name, span }) => ({ name, start: offsetOf(span.start), end: offsetOf(span.end) }))
      .sort((a, b) => a.start - b.start);

   const returnNode = fn.typeAnnotation.typeAnnotation;
   const returnType = src.text(returnNode) || "void";
   const isAsync = !locals.has("Promise") && isPromiseType(returnNode as AstNode);
   return {
      definition: src.text(fn),
      paramsStart: findParamsStart(fn, src),
      params: fn.params.map((param) => {
         const info = getParamInfo(param, src);
         const annotation = (param as AstNode).typeAnnotation?.typeAnnotation;
         return annotation ? { ...info, typeStart: offsetOf(annotation.span.start) } : info;
      }),
      customTypes: Array.from(set),
      returnType,
      returnStart: offsetOf(returnNode.span.start),
      returnsVoid: returnsVoid(returnNode as AstNode, isAsync),
      async: isAsync,
      typeRefs,
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

/** Tab stops of the code frame, which expands a tab to the next multiple of this width. */
const FRAME_TAB_WIDTH = 4;

const WIDE_RANGES: [number, number][] = [
   [0x1100, 0x115f],
   [0x2e80, 0x303e],
   [0x3041, 0xa4cf],
   [0xac00, 0xd7a3],
   [0xf900, 0xfaff],
   [0xfe30, 0xfe6f],
   [0xff00, 0xff60],
   [0xffe0, 0xffe6],
   [0x1f300, 0x1f64f],
   [0x1f900, 0x1f9ff],
   [0x20000, 0x3fffd],
];

/** The number of terminal columns of a character: 0 for combining marks, 2 for wide ones. */
function displayWidth(char: string): number {
   const codePoint = char.codePointAt(0) ?? 0;
   if (/^[\p{Mn}\p{Me}\p{Cf}]$/u.test(char)) {
      return 0;
   }
   const isWide =
      WIDE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to) ||
      /^\p{Emoji_Presentation}$/u.test(char);
   return isWide ? 2 : 1;
}

/** The width of a character at the given column, where a tab fills up to the next tab stop. */
function widthAt(char: string, column: number): number {
   return char === "\t" ? FRAME_TAB_WIDTH - (column % FRAME_TAB_WIDTH) : displayWidth(char);
}

/** Expands the tabs of a line like the code frame of swc does. */
function expandTabs(line: string): string {
   let column = 0;
   let result = "";
   for (const char of line) {
      const width = widthAt(char, column);
      result += char === "\t" ? " ".repeat(width) : char;
      column += width;
   }
   return result;
}

const BOM_CHAR = "\uFEFF";

/**
 * Converts the display column of the caret of a code frame to the column that an editor shows,
 * which counts UTF-16 code units, one for a tab. `frameText` is the line as the frame shows it:
 * if it is not the expansion of the source line, the source is not the one that was parsed
 * and null is returned.
 */
function columnInSource(
   source: string,
   line: number,
   frameText: string,
   displayColumn: number,
): number | null {
   const sourceLine = source.split("\n")[line - 1]?.replace(/\r$/, "");
   const clean = (text: string) => text.replaceAll(BOM_CHAR, "").trimEnd();
   if (sourceLine === undefined || clean(expandTabs(sourceLine)) !== clean(frameText)) {
      return null;
   }
   let width = 0;
   let index = 0;
   for (const char of sourceLine) {
      const next = width + widthAt(char, width);
      if (displayColumn < next) {
         break;
      }
      width = next;
      index += char.length;
   }
   return index - (sourceLine.startsWith(BOM_CHAR) ? 1 : 0) + 1;
}

/** The position just after the last character of the text, as 1-based line and column. */
function endOfInput(source: string): { line: number; column: number } {
   const lines = source.replaceAll(BOM_CHAR, "").split("\n");
   const last = lines[lines.length - 1].replace(/\r$/, "");
   return { line: lines.length, column: last.length + 1 };
}

/**
 * Extracts the reason and the position of a syntax error from the message of an swc parse error,
 * which is a miette-style code frame. The caret line locates the column, in display columns,
 * and the number in front of the code row gives the line. With the parsed `source`, the column
 * is converted to the one that an editor shows (tabs and wide characters count differently), and
 * an error without a caret, which is an error at the end of the input, is given that position.
 */
export function describeSyntaxError(
   error: unknown,
   source?: string,
): {
   reason: string;
   line?: number;
   column?: number;
} {
   const message = error instanceof Error ? error.message : String(error);
   const lines = message.split("\n");
   const reason =
      lines
         .find((row) => row.trim())
         ?.replace(/^\s*x\s+/, "")
         .trim() ?? "Syntax error";
   const caretIndex = lines.findIndex((row) => /^\s*:\s*\^/.test(row));
   const codeRow = caretIndex > 0 ? /^\s*(\d+)\s*\|\s?(.*)$/.exec(lines[caretIndex - 1]) : null;
   if (caretIndex > 0 && codeRow) {
      const gutter = lines[caretIndex - 1].indexOf("|") + 2;
      const displayColumn = Math.max(lines[caretIndex].indexOf("^") - gutter, 0);
      const line = Number(codeRow[1]);
      const column =
         (source === undefined ? null : columnInSource(source, line, codeRow[2], displayColumn)) ??
         displayColumn + 1;
      return { reason, line, column };
   } else if (source !== undefined && lines.some((row) => /^\s*\d+\s*\|/.test(row))) {
      // A frame without a caret: the error is at the end of the input.
      return { reason, ...endOfInput(source) };
   }
   const header = /\[(\d+):(\d+)\]/.exec(message);
   return header ? { reason, line: Number(header[1]), column: Number(header[2]) } : { reason };
}

/**
 * Raised when a schema file is not valid TypeScript. The message names the file,
 * as `path:line:column` when the position is known.
 */
class SchemaSyntaxError extends Error {
   constructor(file: string, cause: unknown, source: string) {
      const { reason, line, column } = describeSyntaxError(cause, source);
      const where = line === undefined ? file : `${file}:${line}:${column}`;
      super(`Syntax error in schema file '${where}': ${reason}`);
      this.name = "SchemaSyntaxError";
   }
}

interface ParseContext {
   file: string;
   src: Source;
   imports: LibraryImports;
   /** The names that the schema file binds at module level, see `collectModuleBindings`. */
   locals: ReadonlySet<string>;
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
   } else if (
      (signature.params as AstNode[]).some((p) => p.type === "Identifier" && p.value === "this")
   ) {
      throw fail("a 'this' parameter is not supported, since IPC does not transfer 'this'.");
   }
   return {
      name,
      kind: info.kind,
      direction: info.direction,
      signature: parseSignature(signature as unknown as TsFunctionType, ctx.src, ctx.locals),
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
   if (!found || found.call !== calls[0]) {
      throw new SchemaError(
         file,
         "the defineChannels call must be exported, with " +
            "'export default defineChannels({...})' or 'export const <name> = defineChannels({...})'.",
      );
   }
   const locals = collectModuleBindings(module);
   const channelSpecs = parseChannelMap(found.call, { file, src, imports, locals });
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

/** The declaration of a module item, unwrapping `export` and `export default`. */
function declarationOf(item: AstNode): AstNode {
   return item.type === "ExportDeclaration"
      ? item.declaration
      : item.type === "ExportDefaultDeclaration"
        ? item.decl
        : item;
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

const TYPE_KINDS = new Map<string, t.TypeKind>([
   ["TsInterfaceDeclaration", "interface"],
   ["TsTypeAliasDeclaration", "type"],
   ["TsEnumDeclaration", "enum"],
   ["TsModuleDeclaration", "namespace"],
   ["ClassDeclaration", "class"],
   // swc parses `export default class X {}` as a class expression.
   ["ClassExpression", "class"],
]);

function isTypeDefinition(node: AstNode): boolean {
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

   const channelSpecArray = vld.validateChannelSpecs(channelSpecs);
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
   parseModule,
   describeSyntaxError,
   forEachChild,
   isBuiltinType,
   collectModuleBindings,
   collectCustomTypes,
   collectLibraryImports,
   parseSignature,
   parseChannelMapModule,
   parseImportDeclarations,
   parseTypeDefinitions,
   parseValueDefinitions,
   applyExportSpecifiers,
   parseSpecs,
};
