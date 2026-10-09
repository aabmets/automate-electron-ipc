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

export interface ImportSpec {
   fromPath: string;
   customTypes: string[];
   namespace: string | null;
}

/**
 * "value" is a variable or function, which a signature can only refer to through `typeof`.
 * "alias" is the name that `import X = ...` declares, which may stand for a type, a value or a
 * namespace.
 */
export type TypeKind = "type" | "interface" | "enum" | "class" | "namespace" | "value" | "alias";

export interface TypeSpec {
   name: string;
   kind: TypeKind;
   generics: string | null;
   isExported: boolean;
   /** Set for `export default interface X` and `export { X as default }`: `default as X`. */
   isDefault?: boolean;
   /** The name of `export { X as Y }`, which is imported as `Y as X`. */
   exportedAs?: string;
   /**
    * The qualified name that `import X = Ns.Y` makes `X` stand for: `Ns.Y`. Set for aliases of
    * entity names. The generated files use it when the alias is not exported.
    */
   aliasOf?: string;
}

export interface CallableParam {
   name: string;
   type: string;
   /** Offset in `definition` where the text of `type` starts. Absent without an annotation. */
   typeStart?: number;
   rest: boolean;
   optional: boolean;
}

/** A reference to a type by name in a signature, as offsets in `definition`. */
export interface TypeRef {
   /** The name to rename: the leftmost identifier, such as `Kind` for `Kind.A`. */
   name: string;
   start: number;
   end: number;
   /**
    * Set for the string literal of an import type, `"./models"` in `import("./models").User`:
    * the specifier that is written there, which is relative to the schema file. `name` is then
    * not a type name.
    */
   importPath?: string;
}

/**
 * A part of a signature that the structured clone algorithm cannot send as written. Electron
 * throws "An object could not be cloned" for a function, a symbol, a WeakMap or a WeakSet, and
 * for a Promise in a parameter, and an instance of a class arrives without its prototype.
 */
export interface CloneIssue {
   /** "error" for what throws at runtime, "warning" for what arrives changed. */
   level: "error" | "warning";
   /** Where in the signature: `parameter 'cb'` or `return type`. */
   where: string;
   /** The offending type as written. */
   type: string;
   /** What it is, such as `a function`. */
   reason: string;
   /** The local types that lead to it, such as `Options → Callback`. */
   via?: string;
}

export interface CallableSignature {
   definition: string;
   /** Offset in `definition` just after the `(` that opens the parameter list. */
   paramsStart: number;
   params: CallableParam[];
   returnType: string;
   /** Offset in `definition` where the text of `returnType` starts. */
   returnStart?: number;
   /** True for `void`, and for `Promise<void>` of an async signature. */
   returnsVoid?: boolean;
   customTypes: string[];
   async: boolean;
   /** The type references of the signature, ordered by position, which writers may rename. */
   typeRefs?: TypeRef[];
   /** What the structured clone algorithm cannot send. Absent when there is nothing. */
   cloneIssues?: CloneIssue[];
   /**
    * The type of the chunks of a `stream` channel: the first type argument of the `AsyncIterable`,
    * `AsyncIterableIterator` or `AsyncGenerator` that the signature returns. Absent for other kinds.
    */
   chunkType?: string;
   /** Offset in `definition` where the text of `chunkType` starts. */
   chunkStart?: number;
}

/** The error types that an `invoke` channel declares in its second type argument. */
export interface ErrorsSpec {
   /** The type as written, such as `NotFoundError | AuthError`. */
   definition: string;
   customTypes: string[];
   /** The type references of `definition`, ordered by position, which writers may rename. */
   typeRefs?: TypeRef[];
}
