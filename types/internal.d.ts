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

export interface IPCOptionalConfig {
   codeIndent?: number;
   channelIdentifierLength?: number;
   namespaceLength?: number;
}

export interface IPCAssuredConfig {
   codeIndent: number;
   channelIdentifierLength: number;
   namespaceLength: number;
}

export interface IPCAutomationOption {
   mainHandlersDir: string;
   browserPreloadFile: string;
   rendererTypesFile: string;
}

export interface FileHeader {
   shebang: string | null;
   license: string | null;
}

export type TypeKind = "type" | "interface";
export type ImportKind = "import" | "require";

export interface TypeSpec {
   kind: TypeKind;
   name: string;
   isExported: boolean;
   definition: string;
}

export interface ImportSpec {
   kind: ImportKind;
   fromPath: string;
   definition: string;
   customTypes: string[];
   namespace: string | null;
}

export interface FuncParam {
   name: string;
   type: string | null;
   defaultValue: string | null;
}

export interface FuncSpec {
   name: string;
   async: boolean;
   params: FuncParam[];
   returnType: string;
   customTypes: string[];
}

export interface ParsedSpecs {
   funcSpecArray: FuncSpec[];
   typeSpecArray: TypeSpec[];
   importSpecArray: ImportSpec[];
}

export interface CollectedSpecs {
   fullPath: string;
   relativePath: string;
   parsedSpecs: ParsedSpecs;
}
