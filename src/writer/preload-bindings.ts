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

export function generatePreloadBindings(
   _config: t.IPCResolvedConfig,
   _fileSpecs: t.ParsedFileSpecs[],
): string {
   return "";
}

export async function writePreloadBindings(
   resolvedConfig: t.IPCResolvedConfig,
   parsedFileSpecs: t.ParsedFileSpecs[],
): Promise<void> {
   const fileContents = generatePreloadBindings(resolvedConfig, parsedFileSpecs);
   await utils.writeFile(resolvedConfig.preloadBindingsFilePath, fileContents);
}

export default { generatePreloadBindings, writePreloadBindings };
