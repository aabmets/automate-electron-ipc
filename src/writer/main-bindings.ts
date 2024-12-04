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
   protected renderEmptyFileContents(): string {
      return `${this.notice}\nexport const ipcMain = {};`;
   }
   protected renderFileContents(): string {
      const electronImportsSet = new Set<string>(["ipcMain as electronIpcMain"]);
      const electronTypeImportsSet = new Set<string>(["IpcMainEvent"]);
      const importDeclarationsArray: string[] = [];
      const callablesArray: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               const method = spec.kind === "Broadcast" ? "on" : "handle";
               const callback = "(event: any, ...args: any[]) => (callback as any)(event, ...args)";
               const ipcMain = `\n${this.indents[1]}electronIpcMain.${method}('${spec.name}', ${callback})`;
               const modSigDef = this.injectEventTypehint(spec.signature.definition);
               const ipcCallable = `on${spec.name}: (callback: ${modSigDef}) => ${ipcMain}`;
               callablesArray.push(ipcCallable);
            } else if (spec.direction === "MainToRenderer") {
               electronTypeImportsSet.add("BrowserWindow");
               const senderCall = `\n${this.indents[1]}browserWindow.webContents.send`;
               const senderParams = this.getOriginalParams(spec, false);
               const sender = `${senderCall}('${spec.name}', ${senderParams})`;
               const ipcParams = this.getOriginalParams(spec, true);
               const ipcSignature = `(browserWindow: BrowserWindow, ${ipcParams})`;
               const ipcCallable = `send${spec.name}: ${ipcSignature} => ${sender}`;
               callablesArray.push(ipcCallable);
            } else if (spec.direction === "RendererToRenderer") {
               electronImportsSet.add("MessageChannelMain");
               electronTypeImportsSet.add("BrowserWindow");
               const propagator = [
                  "{",
                  `${this.indents[1]}const { port1, port2 } = new MessageChannelMain();`,
                  `${this.indents[1]}bwOne.once('ready-to-show', () => {`,
                  `${this.indents[2]}bwOne.webContents.postMessage('${spec.name}', null, [port1]);`,
                  `${this.indents[1]}});`,
                  `${this.indents[1]}bwTwo.once('ready-to-show', () => {`,
                  `${this.indents[2]}bwTwo.webContents.postMessage('${spec.name}', null, [port2]);`,
                  `${this.indents[1]}});`,
                  `${this.indents[0]}}`,
               ].join("\n");
               const ipcSignature = "(bwOne: BrowserWindow, bwTwo: BrowserWindow)";
               const ipcCallable = `propagate${spec.name}Ports: ${ipcSignature} => ${propagator}`;
               callablesArray.push(ipcCallable);
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
               importDeclarationsArray.push(importDeclaration);
            }
         }
      }
      const out = [
         this.notice,
         `import { ${Array.from(electronImportsSet).join(", ")} } from "electron";`,
         `import type { ${Array.from(electronTypeImportsSet).join(", ")} } from "electron";`,
         ...importDeclarationsArray,
      ];
      const bindingsExpression = [
         "\nexport const ipcMain = {",
         `\n${this.indents[0]}${this.stringifyCallablesArray(callablesArray, 0)},`,
         "\n}\n",
      ].join("");

      out.push(bindingsExpression);
      return out.join("\n");
   }
}
