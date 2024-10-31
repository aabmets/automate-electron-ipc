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
import parser from "../src/parser";

export function dedent(text: string): string {
   const reducer = (minIndent: number, line: string) =>
      Math.min(minIndent, line.match(/^(\s*)/)?.[0].length || 0);
   const lines = text.split("\n");
   const indent = lines
      .filter((line) => line.trim()) // Exclude blank lines
      .reduce(reducer, Number.POSITIVE_INFINITY);
   return lines.map((line) => line.slice(indent)).join("\n");
}

export function collectCustomTypes(code: string): Set<string> {
   const sourceFile = ts.createSourceFile("temp.ts", dedent(code), ts.ScriptTarget.Latest, true);
   const customTypes = new Set<string>();
   ts.forEachChild(sourceFile, (node: ts.Node) => {
      parser.collectCustomTypes(node, customTypes, sourceFile);
   });
   return customTypes;
}

export default { dedent, collectCustomTypes };
