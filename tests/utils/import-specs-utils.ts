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

import { forEachChild, parseModule } from "@src/ast.js";
import { parseImportDeclarations as parseNode } from "@src/import-specs.js";
import type { ImportDeclaration } from "@swc/core";
import type * as t from "@types";

export function parseImportDeclarations(code: string): t.ImportSpec[] {
   const { module, src } = parseModule(code);
   const specs: t.ImportSpec[] = [];
   forEachChild(module, (node) => {
      if (node.type === "ImportDeclaration") {
         parseNode(node as ImportDeclaration, src, specs);
      }
   });
   return specs;
}
