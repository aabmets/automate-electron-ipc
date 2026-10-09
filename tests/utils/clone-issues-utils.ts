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

import { parseModule } from "@src/ast.js";
import { collectModuleBindings, collectTypeDeclarations } from "@src/module-bindings.js";
import { parseSignature } from "@src/signature.js";
import type * as t from "@types";

/** Parses the signature of `type Sig = ...` in a module that also contains `declarations`. */
export function issuesOf(definition: string, declarations = "", streaming = false): t.CloneIssue[] {
   const { module, src } = parseModule(`${declarations}\ntype Sig = ${definition};`);
   const alias = module.body.at(-1) as any;
   const signature = parseSignature(
      alias.typeAnnotation,
      src,
      collectModuleBindings(module),
      collectTypeDeclarations(module),
      streaming,
   );
   return signature.cloneIssues ?? [];
}

export function errorsOf(definition: string, declarations = ""): string[] {
   return issuesOf(definition, declarations)
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.where}: ${issue.reason} ${issue.type}`);
}
