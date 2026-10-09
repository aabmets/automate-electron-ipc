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
import utils from "../utils.js";
import type { ImportsGenerator } from "./imports-generator.js";

/** The import lines of the generated `main.ts`, and the `electron` imports that its helpers use. */

/** The import of `ipcMain`, if the generated code registers a listener or a handler. */
export function getIpcMainImport(used: boolean): string[] {
   return used ? ["ipcMain as electronIpcMain"] : [];
}

/** Adds the import lines for the custom types that the channels of the file use. */
export function importCustomTypes(
   importsGenerator: ImportsGenerator,
   pfs: t.ParsedFileSpecs,
   customTypes: Set<string>,
   declarations: string[],
): void {
   for (const customType of customTypes) {
      const declaration = importsGenerator.getDeclaration(pfs, customType);
      if (declaration) {
         declarations.push(declaration);
      }
   }
}

/** The import lines: the values and the types of `electron`, then the ones from the schema files. */
export function buildImports(values: string[], types: string[], declarations: string[]): string[] {
   return [
      ...(values.length > 0 ? [`import { ${values.join(", ")} } from "electron";`] : []),
      ...(types.length > 0 ? [`import type { ${types.join(", ")} } from "electron";`] : []),
      ...declarations.sort(utils.compareStrings),
   ];
}

/** Adds the electron imports that the helpers of the `stream` channels use. */
export function addStreamImports(used: boolean, values: Set<string>, types: Set<string>): void {
   if (used) {
      values.add("MessageChannelMain");
      for (const type of ["MessagePortMain", "WebContents", "WebFrameMain"]) {
         types.add(type);
      }
   }
}

/** Adds the electron types that `resolveIpcTarget` uses: the `IpcMain` of the app or of some contents. */
export function addTargetImports(used: boolean, types: Set<string>): void {
   if (used) {
      types.add("IpcMain");
      types.add("WebContents");
   }
}

/** Adds the electron types that `registerScope` uses. */
export function addScopeImports(used: boolean, types: Set<string>): void {
   if (used) {
      for (const type of ["BrowserWindow", "WebContents", "WebContentsView"]) {
         types.add(type);
      }
   }
}

/**
 * The custom types of the signature that the generated code needs. The main process only pairs
 * a page with a child, and sees none of the traffic, so it needs none for those channels.
 */
export function getImportedTypes(spec: t.ChannelSpec, brokered: boolean): string[] {
   return brokered ? [] : spec.signature.customTypes;
}
