/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import type { BroadcastConfig, Channels, IPCOptionalConfig, UnicastConfig } from "./index";

export type { IPCOptionalConfig, BroadcastConfig, UnicastConfig, Channels };

export interface IPCAssuredConfig {
   ipcSpecPath: string;
   rendererDir: string;
   codeIndent: number;
}

export interface FileHeader {
   shebang: string | null;
   license: string | null;
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
   isExported: boolean;
}

export interface CallableParam {
   name: string;
   type: string | null;
   defaultValue: string | null;
}

export interface CallableSignature {
   params: CallableParam[];
   returnType: string;
   customTypes: string[];
   async: boolean;
}

export type ChannelKind = "broadcast" | "unicast";
export type ChannelDirection = "R2R" | "R2M" | "M2R";

export interface ChannelSpec {
   name: string;
   kind: ChannelKind;
   direction: ChannelDirection;
   signature: CallableSignature;
   listeners?: string[];
}

export interface ParsedSpecs {
   channelSpecArray: ChannelSpec[];
   importSpecArray: ImportSpec[];
   typeSpecArray: TypeSpec[];
}

export interface CollectedContents {
   fullPath: string;
   relativePath: string;
   contents: string;
}

export interface CollectedSpecs {
   fullPath: string;
   relativePath: string;
   parsedSpecs: ParsedSpecs;
}
