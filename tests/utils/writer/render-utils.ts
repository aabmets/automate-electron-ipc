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
import { type TestWriterClass, VitestHelperTypesWriter } from "./test-writers.js";
import { buildFileSpecs, type SimpleChannel } from "./writer-utils.js";

/**
 * Renders the file of a writer for the tests, without the notice. The test must have called
 * `mockGetTargetFilePath` for the class, which gives the file a path that its imports are
 * relative to. `scope` is the surface of the page that the writer is made for.
 */
export function renderSpecs(
   Writer: TestWriterClass,
   pfsArray: t.ParsedFileSpecs[],
   config: Partial<t.IPCResolvedConfig> = {},
   scope: string | null = null,
) {
   return new Writer(pfsArray, config, scope).render(false);
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

/** Where the helper types start in the text of a types module. */
const HELPER_TYPES_START = "\n/** The name of a channel of the API. */";

/**
 * The types of the API in a types module, without the helper types and the imports for them:
 * `IpcApi`, the types it refers to, and the imports of the custom types.
 */
export function renderApiSpecs(
   pfsArray: t.ParsedFileSpecs[],
   config: Partial<t.IPCResolvedConfig> = {},
   scope: string | null = null,
) {
   const output = renderSpecs(VitestHelperTypesWriter, pfsArray, config, scope);
   return output
      .slice(0, output.indexOf(HELPER_TYPES_START))
      .split("\n")
      .filter(
         (line) => !/^import type (\{ ChannelDef \}|ChannelMap\b|\{ \w+ as ChannelMap)/.test(line),
      )
      .join("\n")
      .replace(/^\n+/, "");
}

/** `renderApiSpecs` for channels that are described by `buildFileSpecs`. */
export function renderApiWith(
   channels: readonly SimpleChannel[],
   config: Partial<t.IPCResolvedConfig> = {},
   scope: string | null = null,
) {
   return renderApiSpecs(buildFileSpecs(...channels), config, scope);
}
