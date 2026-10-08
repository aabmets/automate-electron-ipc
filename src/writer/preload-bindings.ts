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
   /** The property of the exposed object, starting with a newline. */
   property: string;
}

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.preloadBindingsFilePath;
   }
   protected renderEmptyFileContents(): string {
      return [
         'import { contextBridge } from "electron";\n',
         "contextBridge.exposeInMainWorld('ipc', {});",
      ].join("\n");
   }
   protected renderFileContents(): string {
      const portNamesArray: string[] = [];
      const channels: ChannelEntry[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               channels.push(this.buildRendererToMainChannel(spec));
            } else if (spec.direction === "MainToRenderer") {
               channels.push(this.buildMainToRendererChannel(spec));
            } else if (spec.direction === "RendererToRenderer") {
               portNamesArray.push(spec.name);
               channels.push({
                  name: spec.name,
                  property: `\n${this.indents[0]}${spec.name}: getPortObject('${spec.name}'),`,
               });
            }
         }
      }
      const out: string[] = ['import { contextBridge, ipcRenderer } from "electron";'];
      if (portNamesArray.length > 0) {
         out.push(
            'import type { IpcRendererEvent } from "electron";',
            this.getPortComponents(),
            ...portNamesArray.map((portName) => this.getPortInitializer(portName).trim()),
         );
      }
      const bindingsExpression = ["\ncontextBridge.exposeInMainWorld('ipc', {"];
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(channel.property);
      }
      bindingsExpression.push("\n});\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
   }

   /**
    * `ipc.<name>.invoke(...args)` for `invoke` channels and `ipc.<name>.send(...args)` for `send`.
    * An invoke gets the envelope of the main process: it returns the value of a successful reply
    * and rejects with the error object of a failed one. It rejects with the plain object
    * `{ name, message, code?, data? }`, not with an `Error`, since contextBridge copies a thrown
    * `Error` as a new `Error` with only the message and the stack, and loses the other fields.
    */
   private buildRendererToMainChannel(spec: t.ChannelSpec): ChannelEntry {
      const method = spec.kind === "Broadcast" ? "send" : "invoke";
      const ipcRenderer = `ipcRenderer.${method}('${spec.name}', ...args)`;
      if (spec.kind === "Unicast" && !this.config.rawErrors) {
         const [, i1, i2, i3] = this.indents;
         const implementation = [
            "async (...args: any[]) => {",
            `${i2}const result = await ${ipcRenderer};`,
            `${i2}if (result.ok) {`,
            `${i3}return result.value;`,
            `${i2}}`,
            `${i2}throw result.error;`,
            `${i1}}`,
         ].join("\n");
         return this.buildChannel(spec.name, method, implementation);
      }
      return this.buildChannel(spec.name, method, `(...args: any[]) => ${ipcRenderer}`);
   }

   /**
    * `ipc.<name>.on(callback)` and `ipc.<name>.once(callback)`. The wrapper that is registered with
    * `ipcRenderer` is created here, in the preload script, because contextBridge hands over a new
    * proxy of the callback on every crossing, so a separate `off(callback)` could not find it. Each
    * method returns a function which removes that one wrapper. The callback never sees the event,
    * and the return value is not `ipcRenderer`, which must not leak into the page.
    */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const [i0, i1, i2, i3] = this.indents;
      const subscribe = (method: "on" | "once") =>
         [
            `${i1}${method}: (callback: Function) => {`,
            `${i2}const listener = (_event: any, ...args: any[]) => callback(...args);`,
            `${i2}ipcRenderer.${method}('${spec.name}', listener);`,
            `${i2}return () => {`,
            `${i3}ipcRenderer.removeListener('${spec.name}', listener);`,
            `${i2}};`,
            `${i1}},`,
         ].join("\n");
      const methods = [subscribe("on"), subscribe("once")].join("\n");
      return { name: spec.name, property: `\n${i0}${spec.name}: {\n${methods}\n${i0}},` };
   }

   private buildChannel(name: string, method: string, implementation: string): ChannelEntry {
      const [i0, i1] = this.indents;
      return { name, property: `\n${i0}${name}: {\n${i1}${method}: ${implementation},\n${i0}},` };
   }

   private getPortComponents() {
      return utils.dedent(`
         const ports: { [key: string]: MessagePort } = {};\n
         type PortObject = { send: Function, on: Function };\n
         function getPortObject(portName: string): PortObject {
            return {
               send: (...args: any[]) => ports[portName].postMessage(args),
               on: (callback: Function) => {
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
