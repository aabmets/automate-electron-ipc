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
      return this.projectUsesNodeNext ? `${baseName}.js` : baseName;
   }

   private resolveImportPath(fromPath: string, sourceFilePath: string): string {
      if (!fromPath.startsWith(".")) {
         // Packages and aliases do not depend on where the generated file is.
         return fromPath;
      }
      return this.adjustImportPath(this.getImportPath(fromPath), sourceFilePath);
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

      // Entries are `Foo`, `Foo as Bar` or `default as Foo`. The local name is what signatures use.
      const localName = (entry: string) => entry.split(" as ").pop();
      if (nameSpace) {
         // `NS.Type` is covered by the import of `NS`, whatever the name of `Type` is.
         const nsSpec = importSpecArray.find((spec) => spec.namespace === nameSpace);
         if (!nsSpec || this.seenImports.nameSpaces.has(nameSpace)) {
            return null;
         }
         this.seenImports.nameSpaces.add(nameSpace);
         const nsPath = this.resolveImportPath(nsSpec.fromPath, parsedFileSpecs.fullPath);
         return `import type * as ${nameSpace} from "${nsPath}";`;
      }
      const importSpec = importSpecArray.find((spec) => {
         return spec.customTypes.some((entry) => localName(entry) === customType);
      });
      const importEntry = importSpec?.customTypes.find((entry) => localName(entry) === customType);
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
      } else if (importSpec && importEntry) {
         const adjustedImportPath = this.resolveImportPath(
            importSpec.fromPath,
            parsedFileSpecs.fullPath,
         );
         if (!this.seenImports.customTypes.has(customType)) {
            this.seenImports.customTypes.add(customType);
            return `import type { ${importEntry} } from "${adjustedImportPath}";`;
         }
      }
      return null;
   }
}
