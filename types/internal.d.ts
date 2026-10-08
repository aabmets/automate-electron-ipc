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

export interface IPCOptionalConfig {
   projectUsesNodeNext?: boolean;
   ipcDataDir?: string;
   codeIndent?: number;
}

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

/** "value" is a variable or function, which a signature can only refer to through `typeof`. */
export type TypeKind = "type" | "interface" | "enum" | "class" | "namespace" | "value";

export interface TypeSpec {
   name: string;
   kind: TypeKind;
   generics: string | null;
   isExported: boolean;
   /** Set for `export default interface X` and `export { X as default }`: `default as X`. */
   isDefault?: boolean;
   /** The name of `export { X as Y }`, which is imported as `Y as X`. */
   exportedAs?: string;
}

export interface CallableParam {
   name: string;
   type: string;
   rest: boolean;
   optional: boolean;
}

export interface CallableSignature {
   definition: string;
   /** Offset in `definition` just after the `(` that opens the parameter list. */
   paramsStart: number;
   params: CallableParam[];
   returnType: string;
   customTypes: string[];
   async: boolean;
}

export type ChannelKind = "Broadcast" | "Unicast" | "Port";
export type ChannelDirection = "RendererToRenderer" | "RendererToMain" | "MainToRenderer";

export interface ChannelSpec {
   name: string;
   kind: ChannelKind;
   direction: ChannelDirection;
   signature: CallableSignature;
   listeners?: string[];
   trigger?: string;
}

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
   channelListeners: string[];
   paramType: string;
   paramRest: boolean;
   paramOptional: boolean;
   sigReturnType: string;
   sigCustomTypes: string[];
}
