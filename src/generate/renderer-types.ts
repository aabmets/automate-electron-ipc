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
import com from "./common.js";

export function rendererFileContent(
   config: t.IPCResolvedConfig,
   fileSpecs: t.ParsedFileSpecs[],
): string {
   const indents = com.getCodeIndents(config);
   const out = com.initFileContents();
   const callables: string[] = [];

   for (const file of fileSpecs) {
      for (const channelSpec of file.specs.channelSpecArray) {
         const sigDef = channelSpec.signature.definition;
         if (channelSpec.direction === "RendererToMain") {
            callables.push(`send${channelSpec.name}: ${sigDef}`);
         } else if (channelSpec.direction === "MainToRenderer") {
            callables.push(`on${channelSpec.name}: (callback: ${sigDef}) => void`);
         } else if (channelSpec.direction === "RendererToRenderer") {
            // TODO: support
         }
      }
   }
   const contents = [
      "\ndeclare global {",
      `\n${indents[0]}interface Window {`,
      `\n${indents[1]}ipc: {`,
      `\n${indents[2]}${com.sortByPrefix(callables).join(`\n${indents[2]}`)}`,
      `\n${indents[1]}};`,
      `\n${indents[0]}}`,
      "\n}\n",
   ].join("");
   out.push(contents);
   return out.join("\n");
}
