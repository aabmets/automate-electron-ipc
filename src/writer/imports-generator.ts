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

import path from "node:path";
import type * as t from "@types";

export class ImportsGenerator {
   private readonly projectUsesNodeNext: boolean;
   private readonly targetFilePath: string;
   private readonly seenImports: t.SeenImports;

   public constructor(projectUsesNodeNext: boolean, targetFilePath: string) {
      this.projectUsesNodeNext = projectUsesNodeNext;
      this.targetFilePath = targetFilePath;
      this.seenImports = {
         customTypes: new Set<string>(),
         nameSpaces: new Set<string>(),
      };
   }

   private splitTypeNamespace(typeName: string): [string | null, string] {
      const [value1, value2] = typeName.split(".", 2);
      return value2 ? [value1, value2] : [null, value1];
   }

   private getImportPath(...paths: string[]): string {
      const joined = path.join(...paths);
      const normalizedPath = joined.replaceAll(path.sep, "/");
      const extLen = path.extname(normalizedPath).length;
      const baseName = normalizedPath.slice(0, normalizedPath.length - extLen);
      return this.projectUsesNodeNext ? `${baseName}.js` : normalizedPath;
   }

   private adjustImportPath(importPath: string, sourceFilePath: string): string {
      const sourceDir = path.dirname(sourceFilePath);
      const targetDir = path.dirname(this.targetFilePath);
      const importAbsolutePath = path.normalize(path.join(sourceDir, importPath));
      let adjustedPath = path.relative(targetDir, importAbsolutePath);
      adjustedPath = adjustedPath.replace(/\\/g, "/");
      if (!["..", "./"].includes(adjustedPath.slice(0, 2))) {
         adjustedPath = `./${adjustedPath}`;
      }
      return adjustedPath;
   }

   public getDeclaration(
      parsedFileSpecs: t.ParsedFileSpecs,
      parsedCustomType: string,
   ): string | null {
      const importSpecArray = parsedFileSpecs.specs.importSpecArray;
      const typeSpecArray = parsedFileSpecs.specs.typeSpecArray;
      const [nameSpace, customType] = this.splitTypeNamespace(parsedCustomType);

      const importSpec = importSpecArray.find((spec) => {
         const hasNameSpace = nameSpace && spec.namespace === nameSpace;
         const hasCustomType = spec.customTypes.includes(customType);
         return hasNameSpace || hasCustomType;
      });
      const typeSpec = typeSpecArray.find((spec) => {
         return spec.name === customType;
      });
      if (typeSpec) {
         const adjustedImportPath = this.adjustImportPath(
            this.getImportPath(path.basename(parsedFileSpecs.fullPath)),
            parsedFileSpecs.fullPath,
         );
         if (!this.seenImports.customTypes.has(customType)) {
            return `import type { ${customType} } from "${adjustedImportPath}";`;
         }
      } else if (importSpec) {
         const adjustedImportPath = this.adjustImportPath(
            importSpec.fromPath,
            parsedFileSpecs.fullPath,
         );
         if (nameSpace && !this.seenImports.nameSpaces.has(nameSpace)) {
            this.seenImports.nameSpaces.add(nameSpace);
            return `import type * as ${nameSpace} from "${adjustedImportPath}";`;
         } else if (customType && !this.seenImports.customTypes.has(customType)) {
            this.seenImports.customTypes.add(customType);
            return `import type { ${customType} } from "${adjustedImportPath}";`;
         }
      }
      return null;
   }
}
