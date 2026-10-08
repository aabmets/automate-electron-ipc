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
import utils from "./utils.js";
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

export const channelPattern = utils.concatRegex([
   /^Channel\(['"](?<name>\w+)['"]\)/,
   /.(?<direction>RendererToMain|MainToRenderer|RendererToRenderer)/,
   /.(?<kind>Broadcast|Unicast|Port)$/,
]);

export function isSignatureAssignment(text: string): boolean {
   const regex = /^signature\s*:\s*type +as\s*\(/;
   return regex.test(text);
}

export function isListenersAssignment(text: string): boolean {
   const regex = /^listeners\s*:\s*\[\s*['"\w\s,]{0,1000}]$/;
   return regex.test(text);
}

export function isTriggerAssignment(text: string): boolean {
   const regex = /^trigger\s*:\s*['"][\w-]*['"]\s*,?/;
   return regex.test(text);
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

export function parseChannelExpressions(
   node: AstNode,
   src: Source,
   spec: Partial<t.ChannelSpec>,
): void {
   if (node.type === "MemberExpression") {
      const text = src.text(node as { span: Span }).replaceAll(/\s*/gm, "");
      const groups = text.match(channelPattern)?.groups;
      Object.assign(spec, groups);
   } else if (node.type === "KeyValueProperty") {
      const start = node.key.span.start;
      const end = node.value.span.end;
      const text = src.text({ span: { start, end, ctxt: 0 } });

      if (isSignatureAssignment(text)) {
         const fn = node.value.typeAnnotation as TsFunctionType | undefined;

         if (node.value.type === "TsAsExpression" && fn?.type === "TsFunctionType") {
            const set = new Set<string>();
            collectCustomTypes(fn as AstNode, src, set);

            const returnType = src.text(fn.typeAnnotation.typeAnnotation) || "void";
            const async = returnType.startsWith("Promise");

            spec.signature = {
               definition: src.text(fn),
               params: fn.params.map((param) => getParamInfo(param, src)),
               customTypes: Array.from(set),
               returnType,
               async,
            } as t.CallableSignature;
         }
      } else if (isListenersAssignment(text)) {
         const regex = /(['"])(\w*)\1/g;
         const matches = [...text.matchAll(regex)];
         if (matches.length > 0) {
            spec.listeners = [];
            matches.forEach((match) => {
               if (spec.listeners && match[2].length > 0) {
                  spec.listeners.push(match[2]);
               }
            });
         }
      } else if (isTriggerAssignment(text)) {
         const regex = /['"](?<trigger>[\w-]*)['"]/;
         const match = text.match(regex);
         if (match) {
            spec.trigger = match?.groups?.trigger;
         }
      }
   }
   forEachChild(node, (child) => parseChannelExpressions(child, src, spec));
}

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
   const namespace = node.specifiers.find((spec) => spec.type === "ImportNamespaceSpecifier");
   if (namespace) {
      importSpec.namespace = namespace.local.value;
      array.push(importSpec);
      return;
   }
   const named = node.specifiers.filter((spec) => spec.type === "ImportSpecifier");
   if (named.length > 0) {
      for (const element of named) {
         const isTypeOnlyImport = node.typeOnly || element.isTypeOnly;
         const localName = element.local.value;
         const exportedName = element.imported ? element.imported.value : null;
         if (isTypeOnlyImport && !isBuiltinType(exportedName || localName)) {
            const typeName = exportedName ? `${exportedName} as ${localName}` : localName;
            customTypes.add(typeName);
         }
      }
      importSpec.customTypes = Array.from(customTypes);
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
   const channelSpecArray: Partial<t.ChannelSpec>[] = [];
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];

   let parsed: { module: Module; src: Source };
   try {
      parsed = parseModule(fileData.contents);
   } catch {
      // Files which are not valid TypeScript cannot contain channel definitions.
      return { typeSpecArray: [], channelSpecArray: [], importSpecArray: [] };
   }
   const { module, src } = parsed;

   module.body.forEach((node: ModuleItem) => {
      const item = node as AstNode;
      if (item.type === "ExpressionStatement") {
         if (src.text(item as { span: Span }).startsWith("Channel")) {
            const spec: Partial<t.ChannelSpec> = {};
            parseChannelExpressions(item, src, spec);
            channelSpecArray.push(spec);
         }
      } else if (item.type === "ImportDeclaration") {
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
      channelSpecArray: vld.validateChannelSpecs(channelSpecArray),
      importSpecArray: importSpecArray.filter((item) => {
         return item.customTypes.length > 0 || item.namespace !== null;
      }),
   };
}

export default {
   parseModule,
   forEachChild,
   isBuiltinType,
   collectCustomTypes,
   channelPattern,
   isSignatureAssignment,
   isListenersAssignment,
   isTriggerAssignment,
   parseChannelExpressions,
   parseImportDeclarations,
   parseTypeDefinitions,
   parseSpecs,
};
