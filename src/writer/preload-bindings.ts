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

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.resolvedConfig.preloadBindingsFilePath;
   }
   protected renderFileContents(): string {
      const out = [this.notice, 'import { contextBridge, ipcRenderer } from "electron/renderer";'];
      const callables: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               const method = spec.kind === "Broadcast" ? "send" : "invoke";
               const ipcRenderer = `ipcRenderer.${method}('${spec.name}', ...args)`;
               const callable = `send${spec.name}: (...args: any[]) => ${ipcRenderer}`;
               callables.push(callable);
            } else if (spec.direction === "MainToRenderer") {
               const callback = "(_event: any, ...args: any[]) => callback(...args)";
               const ipcRenderer = `ipcRenderer.on('${spec.name}', ${callback})`;
               const callable = `on${spec.name}: (callback: Function) => ${ipcRenderer}`;
               callables.push(callable);
            } else if (spec.direction === "RendererToRenderer") {
               // TODO: support
            }
         }
      }
      const sortedCallables = this.sortCallablesByPrefix(callables).join(`,\n${this.indents[0]}`);
      const bindingsExpression = [
         "\ncontextBridge.exposeInMainWorld('ipc', {",
         `\n${this.indents[0]}${sortedCallables},`,
         "\n});\n",
      ].join("");

      out.push(bindingsExpression);
      return out.join("\n");
   }
}
