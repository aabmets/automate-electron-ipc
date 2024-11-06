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

import utils from "@src/utils";
import * as t from "@types";
import ts from "typescript";

export function getParserRegex(): RegExp {
   const functionsRegex = utils.concatRegex([
      /^export\s+(async\s+)?(?<function>function)/,
      /\s+(?<functionName>\w+)\s*\([^)]*\)\s*(?::\s*[^\n]+)?\s+{\n/,
   ]);
   const interfaceRegex = utils.concatRegex([
      /|^(?<exportedInterface>export\s+)?(?<interface>interface)/,
      /\s+(?<interfaceName>\w+)\s*{[\s\S]*?\n}\n/,
   ]);
   const typeRegex = utils.concatRegex([
      /|^(?<exportedType>export\s+)?(?<type>type)/,
      /\s+(?<typeName>\w+)\s*=\s*[\s\S]*?;\n/,
   ]);
   const importRegex = utils.concatRegex([
      /|^(?<import>import\s+)(\*\s+as\s+(?<namespace>\w+)\s+)?/,
      /[\s\S]*?from\s*['"](?<importPath>.*?)['"];?\n/,
   ]);
   return utils.concatRegex([functionsRegex, interfaceRegex, typeRegex, importRegex], "gm");
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

export function collectCustomTypes(
   node: ts.Node | ts.TypeNode | ts.ImportDeclaration | undefined,
   customTypes: Set<string>,
   sourceFile: ts.SourceFile,
): void {
   if (!node) {
      return;
   } else if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(sourceFile);
      if (!isBuiltinType(name)) {
         customTypes.add(name);
      }
   } else if (ts.isTypeLiteralNode(node)) {
      node.members.forEach((member) => {
         if (ts.isPropertySignature(member) && member.type) {
            collectCustomTypes(member.type, customTypes, sourceFile);
         }
      });
   } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      node.types.forEach((subType) => collectCustomTypes(subType, customTypes, sourceFile));
   } else if (ts.isBindingElement(node)) {
      const children = node.getChildren();
      if (children.length === 3 && ts.isIdentifier(children[2])) {
         const name = children[2].getText(sourceFile);
         if (!isBuiltinType(name)) {
            customTypes.add(name);
         }
      }
   } else if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
         clause.namedBindings.elements.forEach((element) => {
            const name = element.name.getText(sourceFile);
            if ((clause?.isTypeOnly || element.isTypeOnly) && !isBuiltinType(name)) {
               customTypes.add(name);
            }
         });
      }
   }
   node.forEachChild((child) => collectCustomTypes(child, customTypes, sourceFile));
}

export function cctFromCode(code: string): Set<string> {
   const sourceFile = ts.createSourceFile(
      "temp.ts",
      utils.dedent(code),
      ts.ScriptTarget.Latest,
      true,
   );
   const customTypes = new Set<string>();

   ts.forEachChild(sourceFile, (node: ts.Node) => {
      collectCustomTypes(node, customTypes, sourceFile);
   });
   return customTypes;
}

export function getFuncSpecs(code: string, skipDedent = false): t.FuncSpec[] {
   const normalizedCode = skipDedent ? code : utils.dedent(code);
   const sourceFile = ts.createSourceFile("temp.ts", normalizedCode, ts.ScriptTarget.Latest, true);
   const funcSpecArray: t.FuncSpec[] = [];

   ts.forEachChild(sourceFile, (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node)) {
         const customTypes = new Set<string>();
         collectCustomTypes(node, customTypes, sourceFile);
         funcSpecArray.push({
            name: node.name?.text || "",
            async: (node.modifiers || []).some(
               (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
            ),
            customTypes: Array.from(customTypes),
            returnType: node.type ? node.type.getText(sourceFile) : "void",
            params: (node.parameters || []).map((param) => {
               return {
                  name: param.name.getText(sourceFile),
                  type: param.type ? param.type.getText(sourceFile) : null,
                  defaultValue: param.initializer ? param.initializer.getText(sourceFile) : null,
               };
            }),
         });
      }
   });
   return funcSpecArray;
}

export function parseSpecs(contents: string): t.ParsedSpecs {
   const normalizedContents = utils.dedent(contents);
   const regex = getParserRegex();
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];
   const funcSignatures: string[] = [];

   let match: RegExpExecArray | null = regex.exec(normalizedContents);
   while (match !== null) {
      const mg = match.groups;
      const kind = (mg?.function ?? mg?.interface ?? mg?.type ?? mg?.import ?? "").trim();
      if (kind === "function") {
         funcSignatures.push(`${match[0].trimEnd()}}\n`);
      } else if (["type", "interface"].includes(kind)) {
         typeSpecArray.push({
            kind: kind as t.TypeKind,
            name: mg?.interfaceName ?? mg?.typeName ?? "",
            isExported: [mg?.exportedInterface, mg?.exportedType].includes("export "),
            definition: match[0],
         });
      } else if (kind === "import") {
         importSpecArray.push({
            kind: kind as t.ImportKind,
            fromPath: mg?.importPath ?? "",
            definition: match[0],
            customTypes: Array.from(cctFromCode(match[0])),
            namespace: mg?.namespace ?? null,
         });
      }
      match = regex.exec(normalizedContents);
   }
   const funcSpecArray: t.FuncSpec[] = getFuncSpecs(funcSignatures.join(""), true);
   return { funcSpecArray, typeSpecArray, importSpecArray };
}

export default {
   getParserRegex,
   isBuiltinType,
   collectCustomTypes,
   cctFromCode,
   getFuncSpecs,
   parseSpecs,
};
