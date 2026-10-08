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

const SCRIPT_EXTENSION = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

/** The extension of the compiled file for each script extension, as NodeNext imports need it. */
const SCRIPT_OUTPUT_EXTENSIONS: Record<string, string> = {
   ts: ".js",
   tsx: ".js",
   js: ".js",
   jsx: ".js",
   mts: ".mjs",
   mjs: ".mjs",
   cts: ".cjs",
   cjs: ".cjs",
};

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

   /**
    * Turns the path of a source file into an import specifier. Only script extensions are
    * replaced: with NodeNext by the extension of the compiled file, otherwise they are dropped.
    * Dots in a file name such as `user.model` belong to the name and are kept.
    */
   private getImportPath(...paths: string[]): string {
      const normalizedPath = path.join(...paths).replaceAll(path.sep, "/");
      const match = SCRIPT_EXTENSION.exec(normalizedPath);
      const baseName = match ? normalizedPath.slice(0, match.index) : normalizedPath;
      const outputExt = match ? SCRIPT_OUTPUT_EXTENSIONS[match[1]] : ".js";
      return this.projectUsesNodeNext ? `${baseName}${outputExt}` : baseName;
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
      // A qualified name such as `Kind.A` or `typeof config.key` is imported through its head.
      const customType = parsedCustomType.split(".")[0];

      // Entries are `Foo`, `Foo as Bar` or `default as Foo`. The local name is what signatures use.
      const localName = (entry: string) => entry.split(" as ").pop();
      // `NS.Type` is covered by the import of `NS`, whatever the name of `Type` is.
      const nsSpec = importSpecArray.find((spec) => spec.namespace === customType);
      if (nsSpec) {
         if (this.seenImports.nameSpaces.has(customType)) {
            return null;
         }
         this.seenImports.nameSpaces.add(customType);
         const nsPath = this.resolveImportPath(nsSpec.fromPath, parsedFileSpecs.fullPath);
         return `import type * as ${customType} from "${nsPath}";`;
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
            this.seenImports.customTypes.add(customType);
            const entry = typeSpec.isDefault ? `default as ${customType}` : customType;
            return `import type { ${entry} } from "${adjustedImportPath}";`;
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
