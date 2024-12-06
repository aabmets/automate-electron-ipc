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

import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.resolvedConfig.preloadBindingsFilePath;
   }
   protected renderEmptyFileContents(): string {
      return [
         'import { contextBridge } from "electron";\n',
         "contextBridge.exposeInMainWorld('ipc', {});",
      ].join("\n");
   }
   protected renderFileContents(): string {
      const portNamesArray: string[] = [];
      const callablesArray: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               const method = spec.kind === "Broadcast" ? "send" : "invoke";
               const ipcRenderer = `ipcRenderer.${method}('${spec.name}', ...args)`;
               const callable = `send${spec.name}: (...args: any[]) => ${ipcRenderer}`;
               callablesArray.push(callable);
            } else if (spec.direction === "MainToRenderer") {
               const callback = "(_event: any, ...args: any[]) => callback(...args)";
               const ipcRenderer = `ipcRenderer.on('${spec.name}', ${callback})`;
               const callable = `on${spec.name}: (callback: Function) => ${ipcRenderer}`;
               callablesArray.push(callable);
            } else if (spec.direction === "RendererToRenderer") {
               portNamesArray.push(spec.name);
            }
         }
      }
      const out: string[] = ['import { contextBridge, ipcRenderer } from "electron";'];
      const sortedCallablesArray = this.sortCallablesArray(callablesArray);
      const sortedCallables = sortedCallablesArray.join(`,\n${this.indents[0]}`);
      const bindingsExpression = [
         "\ncontextBridge.exposeInMainWorld('ipc', {",
         `\n${this.indents[0]}${sortedCallables},`,
      ];
      if (portNamesArray.length > 0) {
         const portComponents = [
            'import type { IpcRendererEvent } from "electron";',
            this.getPortComponents(),
            ...portNamesArray.map((portName) => this.getPortInitializer(portName).trim()),
         ];
         out.push(...portComponents);
         const portBindings = [
            `\n${this.indents[0]}ports: {`,
            ...portNamesArray.map((portName) => this.getPortProperty(portName)),
            `\n${this.indents[0]}},`,
         ];
         bindingsExpression.push(...portBindings);
      }
      bindingsExpression.push("\n});\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }

   private getPortComponents() {
      return utils.dedent(`
         const ports: { [key: string]: MessagePort } = {};\n
         type PortObject = { sendMessage: Function, onMessage: Function };\n
         function getPortObject(portName: string): PortObject {
            return {
               sendMessage: (...args: any[]) => ports[portName].postMessage(args),
               onMessage: (callback: Function) => {
                  ports[portName].onmessage = (event: MessageEvent) => callback(...event.data);
               },
            }
         }
      `);
   }

   private getPortInitializer(portName: string) {
      return utils.dedent(`
         ipcRenderer.on('${portName}', (event: IpcRendererEvent) => {
            ports.${portName} = event.ports[0];
         });
      `);
   }

   private getPortProperty(portName: string) {
      return `\n${this.indents[1]}${portName}: getPortObject('${portName}'),`;
   }
}
