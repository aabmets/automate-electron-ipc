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
import { BaseWriter } from "./base-writer.js";

export class MainBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.mainBindingsFilePath;
   }
   protected renderEmptyFileContents(): string {
      return "\nexport const ipcMain = {};";
   }
   protected renderFileContents(): string {
      const electronImportsSet = new Set<string>(["ipcMain as electronIpcMain"]);
      const electronTypeImportsSet = new Set<string>(["IpcMainEvent"]);
      const importDeclarationsArray: string[] = [];
      const callablesArray: string[] = [];
      const portsArray: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               this.addRendererToMainCallables(spec, callablesArray);
            } else if (spec.direction === "MainToRenderer") {
               electronTypeImportsSet.add("BrowserWindow");
               callablesArray.push(this.buildMainToRendererCallable(spec));
            } else if (spec.direction === "RendererToRenderer") {
               electronImportsSet.add("MessageChannelMain");
               electronTypeImportsSet.add("BrowserWindow");
               portsArray.push(this.buildRendererToRendererPort(spec));
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
      const out: string[] = [
         `import { ${Array.from(electronImportsSet).join(", ")} } from "electron";`,
         `import type { ${Array.from(electronTypeImportsSet).join(", ")} } from "electron";`,
         ...importDeclarationsArray,
      ];
      const sortedCallablesArray = this.sortCallablesArray(callablesArray);
      const sortedCallables = sortedCallablesArray.join(`,\n${this.indents[0]}`);
      const bindingsExpression = [
         "\nexport const ipcMain = {",
         `\n${this.indents[0]}${sortedCallables},`,
      ];
      if (portsArray.length > 0) {
         bindingsExpression.push(
            ...[`\n${this.indents[0]}ports: {`, ...portsArray, `\n${this.indents[0]}},`],
         );
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }
   private addRendererToMainCallables(spec: t.ChannelSpec, callablesArray: string[]): void {
      const method = spec.kind === "Broadcast" ? "on" : "handle";
      const callback = "(event: any, ...args: any[]) => (callback as any)(event, ...args)";
      const ipcMain = `\n${this.indents[1]}electronIpcMain.${method}('${spec.name}', ${callback})`;
      const modSigDef = this.injectEventTypehint(spec.signature.definition);
      const callableNames = spec.listeners ? spec.listeners : [`on${spec.name}`];
      callableNames.forEach((name) => {
         callablesArray.push(`${name}: (callback: ${modSigDef}) => ${ipcMain}`);
      });
   }
   private buildMainToRendererCallable(spec: t.ChannelSpec): string {
      const senderParams = this.getOriginalParams(spec, true);
      let sender = `browserWindow.webContents.send('${spec.name}', ${senderParams})`;
      if (spec.trigger) {
         sender = `browserWindow.on("${spec.trigger}", () => ${sender})`;
      }
      const ipcParams = this.getOriginalParams(spec, false);
      const ipcSignature = `(browserWindow: BrowserWindow, ${ipcParams})`;
      return `send${spec.name}: ${ipcSignature} => \n${this.indents[1]}${sender}`;
   }
   private buildRendererToRendererPort(spec: t.ChannelSpec): string {
      const ipcSig = "(bwOne: BrowserWindow, bwTwo: BrowserWindow)";
      const propagator = [
         "{",
         `${this.indents[3]}const { port1, port2 } = new MessageChannelMain();`,
         `${this.indents[3]}bwOne.once('ready-to-show', () => {`,
         `${this.indents[4]}bwOne.webContents.postMessage('${spec.name}', null, [port1]);`,
         `${this.indents[3]}});`,
         `${this.indents[3]}bwTwo.once('ready-to-show', () => {`,
         `${this.indents[4]}bwTwo.webContents.postMessage('${spec.name}', null, [port2]);`,
         `${this.indents[3]}});`,
         `${this.indents[2]}},`,
      ].join("\n");
      return [
         `\n${this.indents[1]}${spec.name}: {`,
         `\n${this.indents[2]}propagate: ${ipcSig} => ${propagator}`,
         `\n${this.indents[1]}},`,
      ].join("");
   }
}
