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
import com from "./common.js";

export function generateRendererTypes(
   _resolvedConfig: t.IPCResolvedConfig,
   _parsedFileSpecs: t.ParsedFileSpecs[],
): string {
   const indents = com.getCodeIndents(_resolvedConfig);
   const out = com.initFileContents();
   const callables: string[] = [];

   // for (const file of fileSpecs) {
   //    const customTypes: Set<string> = new Set();
   //
   //    for (const spec of file.specs.channelSpecArray) {
   //       if (spec.direction === "RendererToMain") {
   //          callables.push(`send${spec.name}: ${spec.signature.definition}`);
   //       } else if (spec.direction === "MainToRenderer") {
   //          callables.push(`on${spec.name}: (callback: ${spec.signature.definition}) => void`);
   //       } else if (spec.direction === "RendererToRenderer") {
   //          // TODO: support
   //       }
   //       spec.signature.customTypes.forEach((item) => customTypes.add(item));
   //    }
   //    for (const ct of customTypes) {
   //       const [namespace, customType] = com.splitTypeNamespace(ct);
   //       const importSpec = file.specs.importSpecArray.find((spec) => {
   //          return spec.namespace === namespace || spec.customTypes.includes(customType);
   //       });
   //       const typeSpec = file.specs.typeSpecArray.find((spec) => {
   //          return spec.name === customType;
   //       });
   //       if (typeSpec && !importSpec) {
   //          const baseDir = path.basename(file.fullPath);
   //          const importPath = com.adjustImportPath(
   //             com.getImportPath(baseDir, file.relativePath),
   //             file.fullPath,
   //
   //          )
   //       } else if (importSpec) {
   //
   //       }
   //    }
   // }
   // console.debug(customTypes)
   // for (const file of fileSpecs) {
   //    for (const importSpec of file.specs.importSpecArray) {
   //       if (importSpec.customTypes.includes(customType)) {
   //             out.push(`import type { ${customType} } from "${importPath}";`);
   //          } else if (importSpec.namespace === namespace) {
   //             out.push(`import * as ${namespace} from "${importPath}";`);
   //          }
   //    }
   // }
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

export async function writeRendererTypes(
   resolvedConfig: t.IPCResolvedConfig,
   parsedFileSpecs: t.ParsedFileSpecs[],
): Promise<void> {
   const fileContents = generateRendererTypes(resolvedConfig, parsedFileSpecs);
   await utils.writeFile(resolvedConfig.rendererTypesFilePath, fileContents);
}

export default { generateRendererTypes, writeRendererTypes };
