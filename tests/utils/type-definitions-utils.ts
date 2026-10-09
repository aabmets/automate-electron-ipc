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

import { forEachChild, parseModule, type TypeDefinitionNode } from "@src/ast.js";
import { parseTypeDefinitions as parseNodes } from "@src/type-definitions.js";
import type * as t from "@types";

export function parseTypeDefinitions(code: string): t.TypeSpec[] {
   const { module, src } = parseModule(code);
   const specs: t.TypeSpec[] = [];
   forEachChild(module, (node) => {
      const inner = node.declaration ?? node.decl ?? node;
      if (inner.type === "TsInterfaceDeclaration" || inner.type === "TsTypeAliasDeclaration") {
         parseNodes(node as TypeDefinitionNode, src, specs);
      }
   });
   return specs;
}
