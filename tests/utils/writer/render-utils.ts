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

import fsp from "node:fs/promises";
import type * as t from "@types";
import type { TestWriterClass } from "./test-writers.js";
import { buildFileSpecs, type SimpleChannel } from "./writer-utils.js";

/**
 * Writes the file of a writer for the tests and reads it back. The test must have called
 * `mockGetTargetFilePath` for the class, which gives the file a path to be written to. `scope`
 * is the surface of the page that the writer is made for.
 */
export async function renderSpecs(
   Writer: TestWriterClass,
   pfsArray: t.ParsedFileSpecs[],
   config: Partial<t.IPCResolvedConfig> = {},
   scope: string | null = null,
) {
   const writer = new Writer(pfsArray, config, scope);
   await writer.write(false);
   return (await fsp.readFile(writer.getTargetFilePath())).toString();
}

/** `renderSpecs` for channels that are described by `buildFileSpecs`. */
export function renderWith(
   Writer: TestWriterClass,
   channels: readonly SimpleChannel[],
   config: Partial<t.IPCResolvedConfig> = {},
   scope: string | null = null,
) {
   return renderSpecs(Writer, buildFileSpecs(...channels), config, scope);
}
