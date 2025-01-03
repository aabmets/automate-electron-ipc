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

export class RendererTypesWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.rendererTypesFilePath;
   }
   protected renderEmptyFileContents(): string {
      return `\ndeclare global {\n${this.indents[0]}interface Window {}\n}`;
   }
   protected renderFileContents(): string {
      const out: string[] = [];
      const portsArray: string[] = [];
      const callablesArray: string[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (spec.direction === "RendererToMain") {
               this.addRendererToMainCallables(spec, callablesArray);
            } else if (spec.direction === "MainToRenderer") {
               this.addMainToRendererCallables(spec, callablesArray);
            } else if (spec.direction === "RendererToRenderer") {
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
               out.push(importDeclaration);
            }
         }
      }
      const sortedCallablesArray = this.sortCallablesArray(callablesArray);
      const sortedCallables = sortedCallablesArray.join(`\n${this.indents[2]}`);
      const windowDeclaration = [
         "\ndeclare global {",
         `\n${this.indents[0]}interface Window {`,
         `\n${this.indents[1]}ipc: {`,
         `\n${this.indents[2]}${sortedCallables}`,
      ];
      if (portsArray.length > 0) {
         windowDeclaration.push(
            ...[`\n${this.indents[2]}ports: {`, ...portsArray, `\n${this.indents[2]}};`],
         );
      }
      windowDeclaration.push(
         ...[
            `\n${this.indents[1]}};`,
            `\n${this.indents[0]}}`,
            "\n}\n\n",
            "export default Window;\n",
         ],
      );

      out.push(windowDeclaration.join(""));
      return out.join("\n");
   }
   private addRendererToMainCallables(spec: t.ChannelSpec, callablesArray: string[]): void {
      let ipcSignature = spec.signature.definition;
      if (!spec.signature.async) {
         const ipcParams = this.getOriginalParams(spec, false);
         ipcSignature = `(${ipcParams}) => Promise<${spec.signature.returnType}>`;
      }
      callablesArray.push(`send${spec.name}: ${ipcSignature};`);
   }
   private addMainToRendererCallables(spec: t.ChannelSpec, callablesArray: string[]): void {
      const callableNames = spec.listeners ? spec.listeners : [`on${spec.name}`];
      callableNames.forEach((name) => {
         callablesArray.push(`${name}: (callback: ${spec.signature.definition}) => void;`);
      });
   }
   private buildRendererToRendererPort(spec: t.ChannelSpec): string {
      return [
         `\n${this.indents[3]}${spec.name}: {`,
         `\n${this.indents[4]}sendMessage: ${spec.signature.definition};`,
         `\n${this.indents[4]}onMessage: (callback: ${spec.signature.definition}) => void;`,
         `\n${this.indents[3]}};`,
      ].join("");
   }
}
