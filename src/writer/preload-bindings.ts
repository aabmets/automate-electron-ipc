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
   protected renderFileContents(): string {
      const portInitializersArray: string[] = [];
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
               portInitializersArray.push(this.getPortInitializer(spec.name).trim());
               portNamesArray.push(spec.name);
            }
         }
      }
      const sortedCallablesArray = this.sortCallablesByPrefix(callablesArray);
      const sortedCallables = sortedCallablesArray.join(`,\n${this.indents[0]}`);
      const bindingsExpression = [
         "\ncontextBridge.exposeInMainWorld('ipc', {",
         `\n${this.indents[0]}${sortedCallables},`,
      ];
      let out = [this.notice, 'import { contextBridge, ipcRenderer } from "electron";'];
      if (portNamesArray.length > 0) {
         out.push('import type { IpcRendererEvent } from "electron";');
         out.push(this.getPortComponents());
         out = out.concat(portInitializersArray);
         const portNameProps = portNamesArray
            .map((item) => `${item}: getPortObject('${item}')`)
            .join(`,\n${this.indents[1]}`);
         const ports = [
            `\n${this.indents[0]}ports: {`,
            `\n${this.indents[1]}${portNameProps},`,
            `\n${this.indents[0]}},`,
         ].join("");
         bindingsExpression.push(ports);
      }
      bindingsExpression.push("\n});\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }

   private getPortComponents() {
      return utils.dedent(`
         const ports: { [key: string]: MessagePort } = {};
         
         type PortObject = { sendMessage: Function, onMessage: Function };
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
}
