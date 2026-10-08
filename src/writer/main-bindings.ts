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
   protected getReservedNames(): string[] {
      return [
         "ipcMain",
         "electronIpcMain",
         "MessageChannelMain",
         "BrowserWindow",
         "IpcMainEvent",
         "IpcMainInvokeEvent",
      ];
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
               this.addMainToRendererCallables(spec, callablesArray);
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
      const listener =
         `${this.getTypeParams(spec.signature)}(${wrapperParams.filter(Boolean).join(", ")}) => ` +
         `${callbackName}(${forwarded.filter(Boolean).join(", ")})`;
      const ipcMain = `\n${this.indents[1]}electronIpcMain.${method}('${spec.name}', ${listener})`;
      const modSigDef = this.injectEventTypehint(spec.signature, eventType, eventName);
      const callableNames = spec.listeners ? spec.listeners : [`on${utils.capitalize(spec.name)}`];
      callableNames.forEach((name) => {
         callablesArray.push(`${name}: (${callbackName}: ${modSigDef}) => ${ipcMain}`);
      });
   }
   private addMainToRendererCallables(spec: t.ChannelSpec, callablesArray: string[]): void {
      const capitalized = utils.capitalize(spec.name);
      // The name of the window parameter must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const windowName = this.uniqueName("browserWindow", taken);
      const senderParams = this.getOriginalParams(spec, true);
      const sender = `${windowName}.webContents.send('${spec.name}', ${senderParams})`;
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const ipcSignature = `${typeParams}(${windowName}: BrowserWindow, ${ipcParams})`;
      callablesArray.push(`send${capitalized}: ${ipcSignature} => \n${this.indents[1]}${sender}`);
      if (spec.trigger) {
         callablesArray.push(this.buildTriggerBinder(spec));
      }
   }
   /**
    * Builds `bind<Name>(browserWindow, provider)`, which registers one listener for the trigger
    * event, evaluates the provider each time the event fires and returns a disposer.
    */
   private buildTriggerBinder(spec: t.ChannelSpec): string {
      const [i0, i1, i2, i3] = this.indents;
      const args = `[${this.getOriginalParams(spec, false)}]`;
      const provider = `provider: () => ${args} | Promise<${args}>`;
      const event = JSON.stringify(spec.trigger);
      const typeParams = this.getTypeParams(spec.signature);
      return [
         `bind${utils.capitalize(spec.name)}: ${typeParams}(browserWindow: BrowserWindow, ${provider}) => {`,
         `${i1}const listener = async () => {`,
         `${i2}const args = await provider();`,
         `${i2}if (!browserWindow.isDestroyed()) {`,
         `${i3}browserWindow.webContents.send('${spec.name}', ...args);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}browserWindow.on(${event}, listener);`,
         `${i1}return () => {`,
         `${i2}browserWindow.off(${event}, listener);`,
         `${i1}};`,
         `${i0}}`,
      ].join("\n");
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
