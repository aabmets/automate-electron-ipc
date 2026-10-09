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

import type { ImportDeclaration } from "@swc/core";
import type * as t from "@types";
import type { AstNode, Source } from "./ast.js";
import { KEYWORD_TYPES } from "./builtin-types.js";

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

/** The dotted text of an entity name: `Models.User` for `Models.User`. */
function entityNameText(name: AstNode): string {
   return name.type === "TsQualifiedName"
      ? `${entityNameText(name.left)}.${name.right.value}`
      : name.value;
}

/**
 * Records the name that `import X = Ns.Y` or `import X = require("./m")` declares. An exported
 * alias is a declaration of the schema file, which the generated files import from it, like
 * `export type X = ...`. One that is not exported is not visible outside of the schema file, so
 * the generated files resolve it to its target: `Ns.Y` for the first form, and for the second
 * the namespace import `import * as X from "./m"`.
 */
export function parseImportEquals(
   item: AstNode,
   importSpecs: t.ImportSpec[],
   typeSpecs: t.TypeSpec[],
): void {
   const name: string = item.id.value;
   const moduleRef = item.moduleRef as AstNode;
   const isRequire = moduleRef.type === "TsExternalModuleReference";
   if (item.isExport) {
      typeSpecs.push({ name, kind: "alias", generics: null, isExported: true });
   } else if (isRequire) {
      importSpecs.push({ fromPath: moduleRef.expression.value, customTypes: [], namespace: name });
   } else {
      typeSpecs.push({
         name,
         kind: "alias",
         generics: null,
         isExported: false,
         aliasOf: entityNameText(moduleRef),
      });
   }
}
