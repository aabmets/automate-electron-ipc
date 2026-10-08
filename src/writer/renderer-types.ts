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
   /** The methods of the channel, one per line, starting with a newline. */
   methods: string[];
}

export class RendererTypesWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.rendererTypesFilePath;
   }
   protected getReservedNames(): string[] {
      // `IpcApi` is declared by the generated file. `Promise` and `Awaited` are globals
      // that the generated code uses.
      return ["IpcApi", "Promise", "Awaited"];
   }
   protected renderEmptyFileContents(): string {
      return this.renderDeclaration([]);
   }
   protected renderFileContents(): string {
      const out: string[] = [];
      const channels: ChannelEntry[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.direction === "RendererToMain") {
               channels.push(this.buildRendererToMainChannel(spec));
            } else if (spec.direction === "MainToRenderer") {
               channels.push(this.buildMainToRendererChannel(spec));
            } else if (spec.direction === "RendererToRenderer") {
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
               out.push(importDeclaration);
            }
         }
      }
      out.sort(utils.compareStrings);
      out.push(this.renderDeclaration(channels));
      return out.join("\n");
   }
   /**
    * `ipc` is declared as a global variable, which types the bare `ipc`, `window.ipc` and
    * `globalThis.ipc` alike. The empty export makes the file a module, which `declare global`
    * requires.
    */
   private renderDeclaration(channels: ChannelEntry[]): string {
      const i0 = this.indents[0];
      const members = this.sortChannels(channels).flatMap((channel) => [
         `\n${i0}${channel.name}: {`,
         ...channel.methods,
         `\n${i0}};`,
      ]);
      const body = members.length > 0 ? `${members.join("")}\n` : "";
      return [
         `\ninterface IpcApi {${body}}`,
         `\ndeclare global {\n${i0}var ipc: IpcApi;\n}`,
         "\nexport {};\n",
      ].join("\n");
   }
   private buildRendererToMainChannel(spec: t.ChannelSpec): ChannelEntry {
      let ipcSignature = spec.signature.definition;
      const typeParams = this.getTypeParams(spec.signature);
      const signatureHead = `${typeParams}(${this.getOriginalParams(spec, false)})`;
      if (spec.kind === "Broadcast") {
         // `ipcRenderer.send` is fire-and-forget: it returns `undefined`, not a promise.
         ipcSignature = `${signatureHead} => void`;
      } else if (!spec.signature.async) {
         // `ipcRenderer.invoke` always returns a promise, which resolves the thenables inside.
         ipcSignature = `${signatureHead} => Promise<Awaited<${spec.signature.returnType}>>`;
      }
      const method = spec.kind === "Broadcast" ? "send" : "invoke";
      return { name: spec.name, methods: [this.method(method, ipcSignature)] };
   }
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const on = this.method("on", `(callback: ${spec.signature.definition}) => void`);
      return { name: spec.name, methods: [on] };
   }
   private buildPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const definition = spec.signature.definition;
      return {
         name: spec.name,
         methods: [
            this.method("send", definition),
            this.method("on", `(callback: ${definition}) => void`),
         ],
      };
   }
   private method(name: string, type: string): string {
      return `\n${this.indents[1]}${name}: ${type};`;
   }
}
