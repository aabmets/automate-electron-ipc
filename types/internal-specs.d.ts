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

import type { ChannelSpec } from "./internal-channels.js";
import type { ImportSpec, TypeSpec } from "./internal-signature.js";

export type ChannelMapExport = { kind: "default" } | { kind: "named"; name: string };

export interface SpecsCollection {
   channelSpecArray: ChannelSpec[];
   channelMapExport: ChannelMapExport | null;
   importSpecArray: ImportSpec[];
   typeSpecArray: TypeSpec[];
}

export interface FileMeta {
   fullPath: string;
   relativePath: string;
}

export interface RawFileContents extends FileMeta {
   contents: string;
}

export interface ParsedFileSpecs extends FileMeta {
   specs: SpecsCollection;
}

export interface VitestChannelSpec {
   channelKind: string;
   channelDirection: string;
   paramType: string;
   paramRest: boolean;
   paramOptional: boolean;
   sigReturnType: string;
}
