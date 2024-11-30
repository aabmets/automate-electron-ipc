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

import { BaseWriter } from "./base-writer.js";

export class MainBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.resolvedConfig.mainBindingsFilePath;
   }
   protected renderFileContents(): string {
      const out = [
         this.notice,
         'import { ipcMain as electronIpcMain } from "electron/main";',
         'import type { IpcMainEvent, BrowserWindow } from "electron/main";',
      ];
      const callables: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               const method = spec.kind === "Broadcast" ? "on" : "handle";
               const callback = "(event: any, ...args: any[]) => callback(event, ...args)";
               const ipcMain = `\n${this.indents[1]}electronIpcMain.${method}('${spec.name}', ${callback})`;
               const modSigDef = this.injectEventTypehint(spec.signature.definition);
               const callable = `on${spec.name}: (callback: ${modSigDef}) => ${ipcMain}`;
               callables.push(callable);
            } else if (spec.direction === "MainToRenderer") {
               const params = this.getOriginalParams(spec, false);
               const paramsWithTypes = this.getOriginalParams(spec, true);
               const webContents = `\n${this.indents[1]}browserWindow.webContents.send('${spec.name}', ${params})`;
               const callable = `send${spec.name}: (browserWindow: BrowserWindow, ${paramsWithTypes}) => ${webContents}`;
               callables.push(callable);
            } else if (spec.direction === "RendererToRenderer") {
               // TODO: support
            }
            const specCustomTypes = new Set(spec.signature.customTypes);
            customTypes = customTypes.union(specCustomTypes);
         }
         for (const customType of customTypes) {
            const importDeclaration = this.importsGenerator.getDeclaration(
               parsedFileSpecs,
               customType,
            );
            if (importDeclaration) {
               out.push(importDeclaration);
            }
         }
      }
      const sortedCallables = this.sortCallablesByPrefix(callables).join(`,\n${this.indents[0]}`);
      const bindingsExpression = [
         "\nexport const ipcMain = {",
         `\n${this.indents[0]}${sortedCallables},`,
         "\n}\n",
      ].join("");

      out.push(bindingsExpression);
      return out.join("\n");
   }
}
