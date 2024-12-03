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

import type { Stats } from "node:fs";
import type { BroadcastConfig, Channels, IPCOptionalConfig, UnicastConfig } from "./index";

export type { IPCOptionalConfig, BroadcastConfig, UnicastConfig, Channels };

export interface IPCResolvedConfig {
   mainBindingsFilePath: string;
   preloadBindingsFilePath: string;
   rendererTypesFilePath: string;
   projectUsesNodeNext: boolean;
   ipcDataDir: string;
   codeIndent: number;
   ipcSchema: {
      path: string;
      stats: Stats | null;
   };
}

export interface ImportSpec {
   fromPath: string;
   customTypes: string[];
   namespace: string | null;
}

export type TypeKind = "type" | "interface";

export interface TypeSpec {
   name: string;
   kind: TypeKind;
   generics: string | null;
   isExported: boolean;
}

export interface CallableParam {
   name: string;
   type: string;
   rest: boolean;
   optional: boolean;
}

export interface CallableSignature {
   definition: string;
   params: CallableParam[];
   returnType: string;
   customTypes: string[];
   async: boolean;
}

export type ChannelKind = "Broadcast" | "Unicast";
export type ChannelDirection = "RendererToRenderer" | "RendererToMain" | "MainToRenderer";

export interface ChannelSpec {
   name: string;
   kind: ChannelKind;
   direction: ChannelDirection;
   signature: CallableSignature;
   listeners?: string[];
}

export interface SpecsCollection {
   channelSpecArray: ChannelSpec[];
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

export interface SeenImports {
   customTypes: Set<string>;
   nameSpaces: Set<string>;
}
