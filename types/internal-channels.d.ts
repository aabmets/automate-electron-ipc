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

import type { CallableSignature, ErrorsSpec } from "./internal-signature.js";

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

/** A position in a source file: 1-based line, and 1-based column in UTF-16 code units. */
export interface SourcePosition {
   line: number;
   column: number;
}

export interface ChannelSpec {
   name: string;
   /** Where the channel key is in its schema file. Absent for specs that the parser did not make. */
   loc?: SourcePosition;
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
