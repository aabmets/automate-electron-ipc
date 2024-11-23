/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import type * as t from "@types";
import ts from "typescript";
import utils from "./utils.js";
import vld from "./validators.js";

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

export function collectCustomTypes(node: ts.Node, src: ts.SourceFile, set: Set<string>): void {
   if (!node) {
      return;
   } else if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(src);
      if (!isBuiltinType(name)) {
         set.add(name);
      }
   } else if (ts.isTypeLiteralNode(node)) {
      node.members.forEach((member) => {
         if (ts.isPropertySignature(member) && member.type) {
            collectCustomTypes(member.type, src, set);
         }
      });
   } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      node.types.forEach((subType) => collectCustomTypes(subType, src, set));
   } else if (ts.isBindingElement(node)) {
      const children = node.getChildren();
      if (children.length === 3 && ts.isIdentifier(children[2])) {
         const name = children[2].getText(src);
         if (!isBuiltinType(name)) {
            set.add(name);
         }
      }
   } else if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
         clause.namedBindings.elements.forEach((element) => {
            const name = element.name.getText(src);
            if ((clause?.isTypeOnly || element.isTypeOnly) && !isBuiltinType(name)) {
               set.add(name);
            }
         });
      }
   }
   node.forEachChild((child) => collectCustomTypes(child, src, set));
}

export const channelPattern = utils.concatRegex([
   /^Channel\(['"](?<name>\w+)['"]\).(?<kind>Broadcast|Unicast)/,
   /.(?<direction>RendererToMain|MainToRenderer|RendererToRenderer)$/,
]);

export function isSignatureAssignment(text: string): boolean {
   const regex = /^signature\s*:\s*type +as\s*\(/;
   return regex.test(text);
}

export function isListenersAssignment(text: string): boolean {
   const regex = /^listeners\s*:\s*\[\s*['"\w\s,]*]$/;
   return regex.test(text);
}

export function parseChannelExpressions(
   node: ts.Node,
   src: ts.SourceFile,
   spec: Partial<t.ChannelSpec>,
): void {
   if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(src).replaceAll(/\s*/gm, "");
      const groups = text.match(channelPattern)?.groups;
      Object.assign(spec, groups);
   } else if (ts.isPropertyAssignment(node)) {
      const text = node.getText(src);

      if (isSignatureAssignment(text)) {
         const child1 = node.getChildAt(2);
         const child2 = child1.getChildAt(2);

         if (ts.isFunctionTypeNode(child2)) {
            const set = new Set<string>();
            collectCustomTypes(child2, src, set);

            const returnType = child2.type.getText(src) || "void";
            const async = returnType.startsWith("Promise");

            spec.signature = {
               params: child2.parameters.map((param) => {
                  return {
                     name: param.name.getText(),
                     type: param?.type ? param.type.getText() : "any",
                     rest: !!param.dotDotDotToken,
                     optional: !!param.questionToken,
                  } as t.CallableParam;
               }),
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
      }
   }
   node.forEachChild((child) => parseChannelExpressions(child, src, spec));
}

export function parseImportDeclarations(
   node: ts.ImportDeclaration,
   src: ts.SourceFile,
   array: t.ImportSpec[],
): void {
   const customTypes = new Set<string>();
   const moduleSpecifier = node.moduleSpecifier;
   const clause = node.importClause;
   const importSpec: t.ImportSpec = {
      fromPath: moduleSpecifier.getText(src).slice(1, -1),
      customTypes: [],
      namespace: null,
   };
   if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
         importSpec.namespace = clause.namedBindings.name.getText(src);
         array.push(importSpec);
      } else if (ts.isNamedImports(clause.namedBindings)) {
         clause.namedBindings.elements.forEach((element) => {
            const isTypeOnlyImport = clause.isTypeOnly || element.isTypeOnly;
            const localName = element.name.getText(src);
            const exportedName = element.propertyName ? element.propertyName.getText(src) : null;
            if (isTypeOnlyImport && !isBuiltinType(exportedName || localName)) {
               const typeName = exportedName ? `${exportedName} as ${localName}` : localName;
               customTypes.add(typeName);
            }
         });
         importSpec.customTypes = Array.from(customTypes);
         array.push(importSpec);
      }
   }
}

export function parseTypeDefinitions(
   node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
   src: ts.SourceFile,
   array: t.TypeSpec[],
): void {
   let isExported = false;
   node.modifiers?.forEach((mod) => {
      isExported = mod.kind === ts.SyntaxKind.ExportKeyword ? true : isExported;
   });
   const kind = new Map([
      ["InterfaceDeclaration", "interface"],
      ["TypeAliasDeclaration", "type"],
   ]).get(ts.SyntaxKind[node.kind]);

   let generics: string | null = null;
   if (node.typeParameters && node.typeParameters.length > 0) {
      const typeParams = node.typeParameters.map((tp) => tp.getText(src)).join(", ");
      generics = `<${typeParams}>`;
   }
   array.push({
      name: node.name.getText(src),
      kind: kind as t.TypeKind,
      generics,
      isExported,
   });
}

export function parseSpecs(contents: string): t.ParsedSpecs {
   const channelSpecArray: t.ChannelSpec[] = [];
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];

   const src = ts.createSourceFile("temp.ts", contents, ts.ScriptTarget.Latest, true);

   ts.forEachChild(src, (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
         if (node.getText(src).startsWith("Channel")) {
            const partialSpec: Partial<t.ChannelSpec> = {};
            parseChannelExpressions(node, src, partialSpec);
            const validatedSpec = vld.validateChannelSpec(partialSpec);
            channelSpecArray.push(validatedSpec);
         }
      } else if (ts.isImportDeclaration(node)) {
         parseImportDeclarations(node, src, importSpecArray);
      } else if (ts.isInterfaceDeclaration(node)) {
         parseTypeDefinitions(node, src, typeSpecArray);
      } else if (ts.isTypeAliasDeclaration(node)) {
         parseTypeDefinitions(node, src, typeSpecArray);
      }
   });
   return { channelSpecArray, typeSpecArray, importSpecArray };
}

export default {
   isBuiltinType,
   collectCustomTypes,
   channelPattern,
   isSignatureAssignment,
   isListenersAssignment,
   parseChannelExpressions,
   parseImportDeclarations,
   parseTypeDefinitions,
   parseSpecs,
};
