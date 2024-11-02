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

import ts from "typescript";
import utils from "./utils";

export type TypeKind = "type" | "interface";

export interface TypeSpec {
   name: string;
   kind: TypeKind;
   isExported: boolean;
   definition: string;
}

export interface FuncParam {
   name: string;
   type: string | null;
   defaultValue: string | null;
}

export interface FuncSpec {
   name: string;
   params: FuncParam[];
   returnType: string;
   customTypes: string[];
}

export interface ParsedContents {
   funcSpecArray: FuncSpec[];
   typeSpecArray: TypeSpec[];
}

export function getParserRegex(): RegExp {
   return utils.concatRegex(
      [
         /^import[\s\S]*?;\n/,
         /|^const[\s\S]*?require\(.*?\);\n/,
         /|^export\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^<\n]+)?\s+{\n/,
         /|^(export\s+)?(interface)\s+(\w+)\s*{[\s\S]*?\n}\n/,
         /|^(export\s+)?(type)\s+(\w+)\s*=\s*[\s\S]*?;\n/,
      ],
      "gm",
   );
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
   ]).has(typeName);
}

export function collectCustomTypes(
   node: ts.Node | ts.TypeNode | undefined,
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
   }
   node.forEachChild((child) => collectCustomTypes(child, customTypes, sourceFile));
}

export function getFuncSpecs(code: string): FuncSpec[] {
   const sourceFile = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.Latest, true);
   const funcSpecArray: FuncSpec[] = [];

   ts.forEachChild(sourceFile, (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node)) {
         const customTypes = new Set<string>();
         collectCustomTypes(node, customTypes, sourceFile);
         funcSpecArray.push({
            name: node.name?.text || "",
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

export function parseContents(contents: string): ParsedContents {
   const regex = getParserRegex();
   const typeSpecArray: TypeSpec[] = [];
   const funcSignatures: string[] = [];

   let match: RegExpExecArray | null = regex.exec(contents);
   while (match !== null) {
      const kind = match[2] ?? match[5] ?? "function";
      if (kind === "function") {
         funcSignatures.push(`${match[0].trimEnd()}}\n`);
      } else {
         typeSpecArray.push({
            name: match[3] ?? match[6],
            kind: kind as TypeKind,
            isExported: (match[1] ?? match[4] ?? "").trim() === "export",
            definition: match[0],
         });
      }
      match = regex.exec(contents);
   }
   const funcSpecArray: FuncSpec[] = getFuncSpecs(funcSignatures.join(""));
   return { funcSpecArray, typeSpecArray };
}

export default {
   getParserRegex,
   isBuiltinType,
   collectCustomTypes,
   getFuncSpecs,
   parseContents,
};
