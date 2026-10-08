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

interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
}

export class MainBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.mainBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      return [
         "ipc",
         "electronIpcMain",
         "MessageChannelMain",
         "BrowserWindow",
         "IpcMainEvent",
         "IpcMainInvokeEvent",
         // Globals that the generated code uses.
         "Promise",
      ];
   }
   protected renderEmptyFileContents(): string {
      return "export const ipc = {};";
   }
   protected renderFileContents(): string {
      // Only the imports that the generated code uses.
      let usesIpcMain = false;
      const electronImportsSet = new Set<string>();
      const electronTypeImportsSet = new Set<string>();
      const importDeclarationsArray: string[] = [];
      const channels: ChannelEntry[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.direction === "RendererToMain") {
               usesIpcMain = true;
               electronTypeImportsSet.add(this.getEventType(spec));
               channels.push(this.buildRendererToMainChannel(spec));
            } else if (spec.direction === "MainToRenderer") {
               electronTypeImportsSet.add("BrowserWindow");
               channels.push(this.buildMainToRendererChannel(spec));
            } else if (spec.direction === "RendererToRenderer") {
               electronImportsSet.add("MessageChannelMain");
               electronTypeImportsSet.add("BrowserWindow");
               channels.push(this.buildPortChannel(spec));
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
      const electronImports = [
         ...(usesIpcMain ? ["ipcMain as electronIpcMain"] : []),
         ...electronImportsSet,
      ];
      const out: string[] = [
         ...(electronImports.length > 0
            ? [`import { ${electronImports.join(", ")} } from "electron";`]
            : []),
         ...(electronTypeImportsSet.size > 0
            ? [`import type { ${Array.from(electronTypeImportsSet).join(", ")} } from "electron";`]
            : []),
         ...importDeclarationsArray.sort(utils.compareStrings),
      ];
      const [i0] = this.indents;
      const bindingsExpression = ["\nexport const ipc = {"];
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
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
   /** `ipc.<name>.handle(callback)` for `invoke` channels and `ipc.<name>.on(callback)` for `send`. */
   private buildRendererToMainChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
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
      const modSigDef = this.injectEventTypehint(spec.signature, eventType, eventName);
      return {
         name: spec.name,
         members: [
            `\n${i1}${method}: (${callbackName}: ${modSigDef}) =>`,
            `\n${i2}electronIpcMain.${method}('${spec.name}', ${listener}),`,
         ],
      };
   }
   /** `ipc.<name>.send(window, ...args)`, and `ipc.<name>.bind(window, provider)` with a trigger. */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      // The name of the window parameter must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const windowName = this.uniqueName("browserWindow", taken);
      const senderParams = this.getOriginalParams(spec, true);
      const sender = `${windowName}.webContents.send('${spec.name}', ${senderParams})`;
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const ipcSignature = `${typeParams}(${windowName}: BrowserWindow, ${ipcParams})`;
      const members = [`\n${i1}send: ${ipcSignature} =>`, `\n${i2}${sender},`];
      if (spec.trigger) {
         members.push(`\n${this.buildTriggerBinder(spec)}`);
      }
      return { name: spec.name, members };
   }
   /**
    * Builds `bind(browserWindow, provider)`, which registers one listener for the trigger
    * event, evaluates the provider each time the event fires and returns a disposer.
    * An error of the provider or of the send skips that send and goes to `onError`,
    * or to `console.error` without it, so that it is never an unhandled rejection.
    */
   private buildTriggerBinder(spec: t.ChannelSpec): string {
      const [, i1, i2, i3, i4, i5] = this.indents;
      const args = `[${this.getOriginalParams(spec, false)}]`;
      const provider = `provider: () => ${args} | Promise<${args}>`;
      const onError = "onError?: (error: unknown) => void";
      const event = JSON.stringify(spec.trigger);
      const typeParams = this.getTypeParams(spec.signature);
      return [
         `${i1}bind: ${typeParams}(browserWindow: BrowserWindow, ${provider}, ${onError}) => {`,
         `${i2}const listener = async () => {`,
         `${i3}try {`,
         `${i4}const args = await provider();`,
         `${i4}if (!browserWindow.isDestroyed()) {`,
         `${i5}browserWindow.webContents.send('${spec.name}', ...args);`,
         `${i4}}`,
         `${i3}} catch (error) {`,
         `${i4}(onError ?? console.error)(error);`,
         `${i3}}`,
         `${i2}};`,
         `${i2}browserWindow.on(${event}, listener);`,
         `${i2}return () => {`,
         `${i3}browserWindow.off(${event}, listener);`,
         `${i2}};`,
         `${i1}},`,
      ].join("\n");
   }
   /** `ipc.<name>.connect(winA, winB)`, which hands one end of a new port to each window. */
   private buildPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2, i3] = this.indents;
      const connector = [
         `\n${i1}connect: (winA: BrowserWindow, winB: BrowserWindow) => {`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}winA.once('ready-to-show', () => {`,
         `${i3}winA.webContents.postMessage('${spec.name}', null, [port1]);`,
         `${i2}});`,
         `${i2}winB.once('ready-to-show', () => {`,
         `${i3}winB.webContents.postMessage('${spec.name}', null, [port2]);`,
         `${i2}});`,
         `${i1}},`,
      ].join("\n");
      return { name: spec.name, members: [connector] };
   }
}
