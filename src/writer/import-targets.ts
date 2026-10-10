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

import type * as t from "@types";
import type { ImportPathResolver } from "./import-paths.js";

/** What a name in a signature stands for, before a local name in the generated file is chosen. */
export interface Target {
   /** Identifies the declaration: the module that it lives in and the name it is exported under. */
   key: string;
   render: (local: string) => string;
}

/**
 * Finds what a name used in a signature of the schema file refers to: a namespace import,
 * a type that the schema file declares or a named import. Returns null for unknown names.
 */
export function findTarget(
   paths: ImportPathResolver,
   pfs: t.ParsedFileSpecs,
   name: string,
): Target | null {
   const { importSpecArray, typeSpecArray } = pfs.specs;
   const nsSpec = importSpecArray.find((spec) => spec.namespace === name);
   if (nsSpec) {
      const nsPath = paths.resolveImportPath(nsSpec.fromPath, pfs.fullPath);
      return {
         key: `${paths.moduleId(nsSpec.fromPath, pfs.fullPath)}*`,
         render: (local) => `import type * as ${local} from "${nsPath}";`,
      };
   }
   const typeSpec = typeSpecArray.find((spec) => spec.name === name);
   if (typeSpec) {
      const exported = typeSpec.isDefault ? "default" : (typeSpec.exportedAs ?? name);
      const filePath = paths.fileImportPath(pfs.fullPath);
      const fileId = paths.scriptId(pfs.fullPath);
      return { key: `${fileId}#${exported}`, render: namedImport(exported, filePath) };
   }
   // Entries are `Foo`, `Foo as Bar` or `default as Foo`. The local name is what signatures use.
   for (const spec of importSpecArray) {
      for (const entry of spec.customTypes) {
         const [exported, local = exported] = entry.split(" as ");
         if (local === name) {
            const fromPath = paths.resolveImportPath(spec.fromPath, pfs.fullPath);
            const key = `${paths.moduleId(spec.fromPath, pfs.fullPath)}#${exported}`;
            return { key, render: namedImport(exported, fromPath) };
         }
      }
   }
   return null;
}

/**
 * The qualified name that `name` stands for, when the schema file declares it with
 * `import X = Ns.Y` and does not export it. Such a name cannot be imported from the schema
 * file, so the generated files use its target in its place.
 */
export function findAlias(pfs: t.ParsedFileSpecs, name: string): string | null {
   const { importSpecArray, typeSpecArray } = pfs.specs;
   if (importSpecArray.some((spec) => spec.namespace === name)) {
      return null;
   }
   const spec = typeSpecArray.find((item) => item.name === name);
   return spec && !spec.isExported && spec.aliasOf !== undefined ? spec.aliasOf : null;
}

export function namedImport(exported: string, fromPath: string): (local: string) => string {
   return (local) => {
      const entry = exported === local ? local : `${exported} as ${local}`;
      return `import type { ${entry} } from "${fromPath}";`;
   };
}
