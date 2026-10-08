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
      const electronTypeImportsSet = new Set<string>();
      const importDeclarationsArray: string[] = [];
      const callablesArray: string[] = [];
      const portsArray: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.direction === "RendererToMain") {
               electronTypeImportsSet.add(this.getEventType(spec));
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
         ...(electronTypeImportsSet.size > 0
            ? [`import type { ${Array.from(electronTypeImportsSet).join(", ")} } from "electron";`]
            : []),
         ...importDeclarationsArray.sort(utils.compareStrings),
      ];
      const bindingsExpression = ["\nexport const ipcMain = {"];
      if (callablesArray.length > 0) {
         const sortedCallables = this.sortCallablesArray(callablesArray);
         bindingsExpression.push(
            `\n${this.indents[0]}${sortedCallables.join(`,\n${this.indents[0]}`)},`,
         );
      }
      if (portsArray.length > 0) {
         bindingsExpression.push(
            ...[`\n${this.indents[0]}ports: {`, ...portsArray, `\n${this.indents[0]}},`],
         );
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }
   /**
    * Electron passes an `IpcMainInvokeEvent` to `handle` listeners and an `IpcMainEvent`
    * to `on` listeners.
    */
   private getEventType(spec: t.ChannelSpec): string {
      return spec.kind === "Broadcast" ? "IpcMainEvent" : "IpcMainInvokeEvent";
   }
   private addRendererToMainCallables(spec: t.ChannelSpec, callablesArray: string[]): void {
      const method = spec.kind === "Broadcast" ? "on" : "handle";
      const eventType = this.getEventType(spec);
      // The names of the generated parameters must not shadow the ones of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const eventName = this.uniqueName("event", taken);
      const callbackName = this.uniqueName("callback", taken);
      const wrapperParams = [`${eventName}: ${eventType}`, this.getOriginalParams(spec, false)];
      const forwarded = [eventName, this.getOriginalParams(spec, true)];
      // A generic signature's type parameters must be in scope for the wrapper's params.
      const definition = spec.signature.definition.trimStart();
      const typeParams = definition.startsWith("<")
         ? definition.slice(0, definition.indexOf("("))
         : "";
      const listener =
         `${typeParams}(${wrapperParams.filter(Boolean).join(", ")}) => ` +
         `${callbackName}(${forwarded.filter(Boolean).join(", ")})`;
      const ipcMain = `\n${this.indents[1]}electronIpcMain.${method}('${spec.name}', ${listener})`;
      const modSigDef = this.injectEventTypehint(spec.signature.definition, eventType, eventName);
      const callableNames = spec.listeners ? spec.listeners : [`on${utils.capitalize(spec.name)}`];
      callableNames.forEach((name) => {
         callablesArray.push(`${name}: (${callbackName}: ${modSigDef}) => ${ipcMain}`);
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
      return `send${utils.capitalize(spec.name)}: ${ipcSignature} => \n${this.indents[1]}${sender}`;
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
