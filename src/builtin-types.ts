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

/** Type keywords. They cannot be declared or imported, so no local name takes their place. */
export const KEYWORD_TYPES = new Set([
   "string",
   "number",
   "boolean",
   "void",
   "any",
   "unknown",
   "null",
   "undefined",
   "never",
   "object",
]);

const BUILTIN_TYPES = new Set([
   ...KEYWORD_TYPES,
   // Global types that signatures use without an import.
   "Function",
   "Promise",
   // ECMAScript globals.
   "Array",
   "ReadonlyArray",
   "Map",
   "ReadonlyMap",
   "Set",
   "ReadonlySet",
   "WeakMap",
   "WeakSet",
   "WeakRef",
   "Date",
   "RegExp",
   "Error",
   "ArrayBuffer",
   "SharedArrayBuffer",
   "DataView",
   "Int8Array",
   "Uint8Array",
   "Uint8ClampedArray",
   "Int16Array",
   "Uint16Array",
   "Int32Array",
   "Uint32Array",
   "Float32Array",
   "Float64Array",
   "BigInt64Array",
   "BigUint64Array",
   "Iterable",
   "Iterator",
   "AsyncIterable",
   "AsyncIterator",
   "Generator",
   "AsyncGenerator",
   "PromiseLike",
   "ArrayLike",
   // Utility types.
   "Record",
   "Partial",
   "Required",
   "Readonly",
   "Pick",
   "Omit",
   "Exclude",
   "Extract",
   "NonNullable",
   "ReturnType",
   "Parameters",
   "InstanceType",
   "ConstructorParameters",
   "Awaited",
   "Uppercase",
   "Lowercase",
   "Capitalize",
   "Uncapitalize",
   // Global namespaces, such as `Intl.DateTimeFormat`.
   "Intl",
]);

/**
 * Tells whether a name stands for a type keyword or a global type, which every generated file
 * has without an import. A name that the schema file binds itself, by declaring or importing it,
 * is not a global: `locals` are such names, and they take precedence over the global list.
 */
export function isBuiltinType(typeName: string, locals?: ReadonlySet<string>): boolean {
   return KEYWORD_TYPES.has(typeName) || (BUILTIN_TYPES.has(typeName) && !locals?.has(typeName));
}
