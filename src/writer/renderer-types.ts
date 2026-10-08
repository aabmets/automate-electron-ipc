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
import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";

interface ChannelEntry {
   name: string;
   /** Whether the promise of the channel can be rejected with an `IpcError`. */
   throws?: boolean;
   /** Whether the channel has an overflow callback, which uses the types of the overflow. */
   overflows?: boolean;
   /** Whether the promise of the channel can be rejected with an `IpcTimeoutError`. */
   times?: boolean;
   /** Whether the channel returns an `IpcStream`. */
   streams?: boolean;
   /** The methods of the channel, one per line, starting with a newline. */
   methods: string[];
}

export class RendererTypesWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.rendererTypesFilePath;
   }
   protected getReservedNames(): string[] {
      // `IpcApi` is declared by the generated file. `Promise`, `Awaited` and `Parameters` are
      // globals that the generated code uses.
      return [
         "IpcApi",
         "IpcError",
         "IpcTimeoutError",
         "IpcPortOverflowInfo",
         "IpcPortOverflowAction",
         "IpcStream",
         "Error",
         "Symbol",
         "IteratorResult",
         "Promise",
         "Awaited",
         "Parameters",
      ];
   }
   protected isEmpty(): boolean {
      return !this.hasRendererChannels();
   }
   protected renderEmptyFileContents(): string {
      return this.renderDeclaration([]);
   }
   protected renderFileContents(): string {
      const out: string[] = [];
      const channels: ChannelEntry[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (this.isUtilitySpec(spec)) {
               continue;
            }
            if (spec.kind === "Port") {
               // The page has the same API for both peers: another page, or the main process.
               channels.push(this.buildPortChannel(spec));
            } else if (spec.kind === "Stream") {
               channels.push(this.buildStreamChannel(spec));
            } else if (spec.direction === "RendererToMain") {
               channels.push(this.buildRendererToMainChannel(spec));
            } else if (spec.direction === "MainToRenderer") {
               channels.push(this.buildMainToRendererChannel(spec));
            }
            const specCustomTypes = new Set([
               ...spec.signature.customTypes,
               ...(spec.errors?.customTypes ?? []),
            ]);
            customTypes = customTypes.union(specCustomTypes);
         }
         for (const customType of customTypes) {
            const importDeclaration = this.importsGenerator.getDeclaration(
               parsedFileSpecs,
               customType,
            );
            if (importDeclaration) {
               out.push(importDeclaration);
            }
         }
      }
      out.sort(utils.compareStrings);
      out.push(this.renderDeclaration(channels));
      return out.join("\n");
   }
   /**
    * `ipc` is declared as a global variable, which types the bare `ipc`, `window.ipc` and
    * `globalThis.ipc` alike. The empty export makes the file a module, which `declare global`
    * requires.
    */
   private renderDeclaration(channels: ChannelEntry[]): string {
      const i0 = this.indents[0];
      const [, i1, i2] = this.indents;
      const members = this.sortChannels(channels).flatMap((channel) => [
         `\n${i0}${channel.name}: {`,
         ...channel.methods,
         `\n${i0}};`,
      ]);
      const body = members.length > 0 ? `${members.join("")}\n` : "";
      // The error type is declared only if a rejected invoke can carry one.
      const errorType = channels.some((channel) => channel.throws)
         ? [
              `${i0}/**`,
              `${i0} * The object that the promise of \`ipc.<name>.invoke\` is rejected with when the handler`,
              `${i0} * throws, and that a read of \`ipc.<name>.stream\` is rejected with when the stream fails.`,
              `${i0} * It is a plain object, since contextBridge does not keep the fields of an \`Error\`.`,
              `${i0} */`,
              `${i0}type IpcError<E extends Error = Error> = E extends unknown`,
              `${i1}? { name: E['name']; message: string } & (E extends { code: infer C extends string | number }`,
              `${i2}? { code: C }`,
              `${i2}: { code?: string | number }) & (E extends { data: infer D }`,
              `${i2}? { data: D }`,
              `${i2}: { data?: unknown })`,
              `${i1}: never;`,
           ].join("\n")
         : "";
      // The stream type is declared only if a stream channel uses it.
      const streamType = channels.some((channel) => channel.streams)
         ? [
              `\ninterface IpcStream<T> {`,
              `${i0}/** The next chunk. The promise is rejected with the error of the stream, if it fails. */`,
              `${i0}next(): Promise<IteratorResult<T, undefined>>;`,
              `${i0}/** Stops the stream and the generator in the main process. */`,
              `${i0}return(): Promise<IteratorResult<T, undefined>>;`,
              `${i0}/** Stops the stream and the generator in the main process, like \`return()\` does. */`,
              `${i0}cancel(): void;`,
              `${i0}[Symbol.asyncIterator](): IpcStream<T>;`,
              "}",
           ]
         : [];
      // The timeout error is declared only if a channel can time out.
      const timeoutType = channels.some((channel) => channel.times)
         ? [
              `${i0}/** The error that the promise of an \`invoke\` is rejected with after its \`timeoutMs\`. */`,
              `${i0}type IpcTimeoutError = Error & { name: 'IpcTimeoutError'; code: 'IPC_TIMEOUT' };`,
           ].join("\n")
         : "";
      const globals = [
         `${i0}var ipc: IpcApi;`,
         ...(errorType ? [errorType] : []),
         ...(timeoutType ? [timeoutType] : []),
      ];
      // The types of the overflow callbacks, declared only if a port channel has them.
      const overflowTypes = channels.some((channel) => channel.overflows)
         ? [
              `\ninterface IpcPortOverflowInfo {`,
              `${i0}channel: string;`,
              `${i0}max: number;`,
              `${i0}dropped: number;`,
              `${i0}warnings: number;`,
              "}",
              `\ntype IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';`,
           ]
         : [];
      return [
         ...overflowTypes,
         ...streamType,
         `\ninterface IpcApi {${body}}`,
         `\ndeclare global {\n${globals.join("\n")}\n}`,
         "\nexport {};\n",
      ].join("\n");
   }
   private buildRendererToMainChannel(spec: t.ChannelSpec): ChannelEntry {
      let ipcSignature = spec.signature.definition;
      const typeParams = this.getTypeParams(spec.signature);
      const signatureHead = `${typeParams}(${this.getOriginalParams(spec, false)})`;
      if (spec.kind === "Broadcast") {
         // `ipcRenderer.send` is fire-and-forget: it returns `undefined`, not a promise.
         ipcSignature = `${signatureHead} => void`;
      } else if (!spec.signature.async) {
         // `ipcRenderer.invoke` always returns a promise, which resolves the thenables inside.
         ipcSignature = `${signatureHead} => Promise<Awaited<${spec.signature.returnType}>>`;
      }
      const method = spec.kind === "Broadcast" ? "send" : "invoke";
      const times = spec.kind === "Unicast" && this.getTimeoutMs(spec) > 0;
      if (spec.kind === "Broadcast" || (this.config.rawErrors && !times)) {
         return { name: spec.name, methods: [this.method(method, ipcSignature)] };
      }
      // With `rawErrors`, only the timeout is an `IpcError`. The errors of the handler stay Electron's.
      const declared = this.config.rawErrors ? undefined : spec.errors?.definition;
      const errorType = [declared, times ? "IpcTimeoutError" : undefined]
         .filter(Boolean)
         .join(" | ");
      const doc = `/** @throws {${errorType ? `IpcError<${errorType}>` : "IpcError"}} */`;
      return {
         name: spec.name,
         throws: true,
         times,
         methods: [this.method(method, ipcSignature, doc)],
      };
   }
   /**
    * `ipc.<name>.stream(...args)` returns an `IpcStream` of the chunks, not the iterable that the
    * handler returns: the page cannot hand a signal over `contextBridge`, so it stops the stream
    * with `cancel()` or `return()`, and a failure rejects the read with the error object.
    */
   private buildStreamChannel(spec: t.ChannelSpec): ChannelEntry {
      const signatureHead = `${this.getTypeParams(spec.signature)}(${this.getOriginalParams(spec, false)})`;
      const chunk = spec.signature.chunkType ?? "unknown";
      const errorType = spec.errors ? `IpcError<${spec.errors.definition}>` : "IpcError";
      const doc = `/** @throws {${errorType}} when the stream fails, from a read of the stream */`;
      return {
         name: spec.name,
         throws: true,
         streams: true,
         methods: [this.method("stream", `${signatureHead} => IpcStream<${chunk}>`, doc)],
      };
   }
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      if (spec.kind === "Unicast") {
         // The single responder to the questions of the main process. It may answer in a promise.
         const respond = `(callback: ${spec.signature.definition}) => () => void`;
         return { name: spec.name, methods: [this.method("handle", respond)] };
      }
      // Subscribing returns a function which removes that one listener.
      const subscribe = `(callback: ${spec.signature.definition}) => () => void`;
      return {
         name: spec.name,
         methods: [this.method("on", subscribe), this.method("once", subscribe)],
      };
   }
   private buildPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const definition = spec.signature.definition;
      const subscribe = `(callback: ${definition}) => () => void`;
      const listen = "(callback: () => void) => () => void";
      // The callback of a full send queue gets the new message, not the queue, and decides what to drop.
      const message = `Parameters<${definition}>`;
      const overflow = `(callback: (message: ${message}, info: IpcPortOverflowInfo) => IpcPortOverflowAction) => () => void`;
      // The connection to one peer: the channel itself, with `close`.
      const connection = `{ send: ${definition}; on: ${subscribe}; onReady: ${listen}; onClose: ${listen}; onOverflow: ${overflow}; close: () => void }`;
      return {
         name: spec.name,
         overflows: true,
         methods: [
            this.method("send", definition),
            this.method("on", subscribe),
            this.method("onReady", listen),
            this.method("onClose", listen),
            this.method("onOverflow", overflow),
            this.method(
               "onConnection",
               `(callback: (connection: ${connection}) => void) => () => void`,
            ),
         ],
      };
   }
   private method(name: string, type: string, doc?: string): string {
      const i1 = this.indents[1];
      return `${doc ? `\n${i1}${doc}` : ""}\n${i1}${name}: ${type};`;
   }
}
