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
   /**
    * Leaves the errors of `invoke` handlers to Electron, which reports them to the renderer as
    * `Error invoking remote method 'X': Error: message`. Off by default: the error then reaches
    * the renderer as an object with its name, message, code and data.
    */
   rawErrors?: boolean;
   /**
    * Put in front of every channel name that Electron sees, so that the channels cannot collide with
    * the ones of other code that uses `ipcMain` directly. `getUser` travels as `autoipc:getUser`.
    * The names in the generated API stay as they are in the schema. `""` turns the prefix off.
    */
   channelPrefix?: string;
   /**
    * The default time in milliseconds after which the promise of an `invoke` is rejected with an
    * `IpcTimeoutError`, when the handler has not answered. `0`, the default, waits for ever. The
    * `timeoutMs` option of a channel overrides it. It is also the default of the calls to a utility
    * process (`callUtility`, `callMain` and `invokeUtility`), which are rejected with an
    * `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`, but not of `streamUtility`.
    */
   timeoutMs?: number;
   /**
    * The path of the generated file for utility processes, relative to the project root. Defaults
    * to `utility.ts` in `ipcDataDir`. The file is written only if the schema has a channel to a
    * utility process.
    */
   utilityBindingsPath?: string;
   /**
    * The path of the generated preload script for service workers, relative to the project root.
    * Defaults to `service-worker-preload.ts` in `ipcDataDir`. The typings of the API of the worker
    * go to `service-worker.d.ts` next to it. Both files are written only if the schema has a
    * channel to or from a service worker.
    */
   serviceWorkerPreloadPath?: string;
   /**
    * The name that the API is exposed as in the page, and that `window.d.ts` declares it as.
    * Defaults to `"ipc"`. It must be an identifier that is not a reserved word or a global of the
    * page, such as `name` or `status`.
    */
   exposeAs?: string;
   /**
    * Exposes the API in the isolated world with this ID, with `contextBridge.exposeInIsolatedWorld`,
    * instead of in the main world. It must be an integer of 1000 or more, since Electron keeps the
    * lower IDs for itself. Without it, the API is exposed in the main world.
    */
   isolatedWorldId?: number;
   /**
    * Whether the generated `preload.ts` exposes the API as soon as it loads. On by default. Turn it
    * off to import `api` and `expose` from the preload file and expose the API from your own preload
    * code, under any number of keys.
    */
   autoExpose?: boolean;
   /**
    * Adds `getPathForFile(file: File): string` to the exposed API, which returns the path of a file
    * that the user dropped or picked, through `webUtils.getPathForFile`. Off by default.
    */
   getPathForFile?: boolean;
   /**
    * A module that exports the functions `serialize(value)` and `deserialize(wire)`, in the shape
    * of superjson: what `serialize` returns must be cloneable by Electron, and `deserialize` turns
    * it back into the value. The generated main and preload code apply them to the arguments and
    * the results of the channels between a page and the main process, so that a `Date`, a `Map` or a
    * class instance arrives as it was sent. A value that starts with `.` is a path relative to the
    * project root, and any other value is a package, such as `"superjson"`. Off by default.
    */
   serializer?: string;
}

export interface IPCResolvedConfig {
   /** The directory of the nearest `package.json`, with `/` separators. */
   projectRoot: string;
   mainBindingsFilePath: string;
   preloadBindingsFilePath: string;
   rendererTypesFilePath: string;
   utilityBindingsFilePath: string;
   serviceWorkerPreloadFilePath: string;
   serviceWorkerTypesFilePath: string;
   projectUsesNodeNext: boolean;
   ipcDataDir: string;
   codeIndent: number;
   rawErrors: boolean;
   channelPrefix: string;
   timeoutMs: number;
   exposeAs: string;
   isolatedWorldId?: number;
   autoExpose: boolean;
   getPathForFile: boolean;
   serializer?: string;
   /** The path of the `serializer` module with `/` separators, when the config gives a path. */
   serializerFilePath?: string;
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

export type ChannelKind = "Broadcast" | "Unicast" | "Port" | "Stream";
/**
 * `RendererToUtility` is a call or a stream from a page to a utility process, over a port that
 * the main process brokers. `MainToUtility` and `UtilityToMain` are the channels of the main
 * process itself with a utility process, and `ServiceWorkerToMain` and `MainToServiceWorker` those
 * with a service worker.
 */
export type ChannelDirection =
   | "RendererToRenderer"
   | "RendererToMain"
   | "MainToRenderer"
   | "MainToUtility"
   | "UtilityToMain"
   | "RendererToUtility"
   | "ServiceWorkerToMain"
   | "MainToServiceWorker";

/** An identifier of the schema file which is a value import, such as `userArgs` in `{ userArgs }`. */
export interface ValidatorRef {
   /** The name that the schema file binds, which the signature of no channel uses. */
   name: string;
   /** The name that the module exports it under: `"default"` for a default import. */
   exported: string;
   /** The module specifier as written in the schema file. */
   fromPath: string;
}

export interface ChannelSpec {
   name: string;
   kind: ChannelKind;
   direction: ChannelDirection;
   signature: CallableSignature;
   /** The error types that a RendererToMain or RendererToUtility Unicast or Stream channel may fail with. An `ask` has none. */
   errors?: ErrorsSpec;
   trigger?: string;
   /**
    * The origins that may call a RendererToMain channel, compared with `senderFrame.origin`, or a
    * ServiceWorkerToMain channel, compared with the origin of the scope of the worker.
    */
   allowedOrigins?: string[];
   /** A Standard Schema for the arguments of a RendererToMain channel, run before the handler. */
   validate?: ValidatorRef;
   /**
    * The most messages that a send queue of a port channel holds while there is no port, or
    * `Infinity`. Absent means the default of the generated code.
    */
   maxQueue?: number;
   /**
    * The most chunks of a Stream channel that the page has not read yet, which the producer may
    * send ahead, or `Infinity` for no limit. Absent means the default of the generated code.
    */
   highWaterMark?: number;
   /**
    * The time in milliseconds after which an `invoke` channel rejects with an `IpcTimeoutError`, or a
    * channel to a utility process with an `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`.
    * `0` means no timeout, also where the config sets a default. Absent means the default of the
    * config.
    */
   timeoutMs?: number;
   /**
    * The scopes that the channel belongs to: the windows that have one of them get the channel in
    * their API, and the main process rejects the calls of the other windows. Absent means that the
    * channel is open to all windows. Only the channels that a page takes part in have it.
    */
   scopes?: string[];
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
   paramType: string;
   paramRest: boolean;
   paramOptional: boolean;
   sigReturnType: string;
}
