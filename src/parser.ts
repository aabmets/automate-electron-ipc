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

import * as t from "@types";
import ts from "typescript";
import utils from "./utils.js";

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

const channelPattern = utils.concatRegex([
   /^Channel\(['"](?<name>\w+)['"]\).(?<kind>Broadcast|Unicast+)/,
   /.(?<direction>RendererToMain|MainToRenderer|RendererToRenderer)$/,
]);

function isSignatureAssignment(text: string): boolean {
   const regex = /^signature\s*:\s*type +as\s*\(/;
   return regex.test(text);
}

function isListenersAssignment(text: string): boolean {
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
      if (groups) {
         Object.assign(spec, {
            ...groups,
            direction: new Map([
               ["RendererToMain", "R2M"],
               ["MainToRenderer", "M2R"],
               ["RendererToRenderer", "R2R"],
            ]).get(groups.direction),
         });
      }
   } else if (ts.isPropertyAssignment(node)) {
      const text = node.getText(src);

      if (isSignatureAssignment(text)) {
         const sig: Partial<t.CallableSignature> = {};
         const child1 = node.getChildAt(2);
         const child2 = child1.getChildAt(2);

         if (ts.isFunctionTypeNode(child2)) {
            const set = new Set<string>();
            collectCustomTypes(child2, src, set);

            sig.params = child2.parameters.map((param) => {
               return {
                  name: param.name.getText(),
                  type: param?.type ? param.type.getText() : "any",
               } as t.CallableParam;
            });
            sig.customTypes = Array.from(set);
            sig.returnType = child2.type.getText(src) || "void";
            sig.async = sig.returnType.startsWith("Promise");
            spec.signature = sig as t.CallableSignature;
            console.debug(sig);
         }
      } else if (isListenersAssignment(text)) {
         const regex = /(['"])(\w*)\1/g;
         const matches = [...text.matchAll(regex)];
         spec.listeners = matches.map((match) => match[2]);
         // TODO: validate listeners format
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
            const name = element.name.getText(src);
            if ((clause?.isTypeOnly || element.isTypeOnly) && !isBuiltinType(name)) {
               customTypes.add(name);
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
   array.push({
      name: node.name.getText(src),
      kind: kind as t.TypeKind,
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
            const spec: Partial<t.ChannelSpec> = {};
            parseChannelExpressions(node, src, spec);
            // TODO: validate spec before pushing to array
            channelSpecArray.push(spec as t.ChannelSpec);
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
   parseChannelExpressions,
   parseImportDeclarations,
   parseTypeDefinitions,
   parseSpecs,
};
