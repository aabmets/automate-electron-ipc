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

import type { ImportDeclaration, Module, ModuleItem } from "@swc/core";
import type * as t from "@types";
import { validateChannelSpecs } from "../validation/channel-validation.js";
import { validateTypeSpecs } from "../validation/global-validation.js";
import type { AstNode, Source, TypeDefinitionNode } from "./ast.js";
import { parseModule } from "./ast.js";
import { parseChannelMapModule } from "./channel/channel-map.js";
import { SchemaSyntaxError } from "./diagnostics.js";
import { parseImportDeclarations, parseImportEquals } from "./import-specs.js";
import { declarationOf, isTypeDefinition } from "./module-bindings.js";
import {
   applyExportSpecifiers,
   isValueDefinition,
   parseTypeDefinitions,
   parseValueDefinitions,
} from "./type/type-definitions.js";

export function parseSpecs(fileData: t.RawFileContents): t.SpecsCollection {
   const importSpecArray: t.ImportSpec[] = [];
   const typeSpecArray: t.TypeSpec[] = [];

   const file = fileData.fullPath || fileData.relativePath || "<unknown>";
   let parsed: { module: Module; src: Source };
   try {
      parsed = parseModule(fileData.contents);
   } catch (error) {
      throw new SchemaSyntaxError(file, error, fileData.contents);
   }
   const { module, src } = parsed;
   const { channelSpecs, channelMapExport } = parseChannelMapModule(module, src, file);

   module.body.forEach((node: ModuleItem) => {
      const item = node as AstNode;
      if (item.type === "ImportDeclaration") {
         parseImportDeclarations(item as ImportDeclaration, src, importSpecArray);
      } else if (item.type === "TsImportEqualsDeclaration") {
         parseImportEquals(item, importSpecArray, typeSpecArray);
      } else if (isTypeDefinition(item)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDeclaration" && isTypeDefinition(item.declaration)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (item.type === "ExportDefaultDeclaration" && isTypeDefinition(item.decl)) {
         parseTypeDefinitions(item as TypeDefinitionNode, src, typeSpecArray);
      } else if (isValueDefinition(declarationOf(item))) {
         parseValueDefinitions(item, typeSpecArray);
      }
   });

   applyExportSpecifiers(module.body as AstNode[], typeSpecArray);

   const channelSpecArray = validateChannelSpecs(channelSpecs, file);
   return {
      typeSpecArray: validateTypeSpecs(typeSpecArray, channelSpecArray),
      channelSpecArray,
      importSpecArray: importSpecArray.filter((item) => {
         return item.customTypes.length > 0 || item.namespace !== null;
      }),
      channelMapExport,
   };
}
