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
import { BaseWriter } from "../base-writer.js";
import {
   hasRendererChannels,
   isBrokeredSpec,
   isUtilitySpec,
   isWorkerSpec,
} from "../channel-kinds.js";
import {
   type ChannelEntry,
   type DeclarationOptions,
   renderDeclaration,
} from "./renderer-declaration.js";

/** The page channels of a schema file, which the helper types look up in its channel map. */
export interface ChannelsOfFile {
   pfs: t.ParsedFileSpecs;
   names: string[];
}

/**
 * What the writers of a page gather from its channels: the entries of the channels, the import
 * lines of the custom types that their signatures use, in order, and the page channels of each
 * schema file.
 */
export interface CollectedChannels {
   channels: ChannelEntry[];
   imports: string[];
   files: ChannelsOfFile[];
}

export class RendererTypesWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.getScopedFilePath(this.config.rendererTypesFilePath);
   }
   protected getTypesFilePath(): string {
      return this.getScopedFilePath(this.config.typesFilePath);
   }
   protected getReservedNames(): string[] {
      // The names that the types module declares. `Promise`, `Awaited` and `Parameters` are
      // globals that the generated code uses.
      return [
         "IpcApi",
         "IpcError",
         "IpcTimeoutError",
         "IpcPortOverflowInfo",
         "IpcPortOverflowAction",
         "IpcStream",
         "IpcUtilityError",
         "Error",
         "Symbol",
         "IteratorResult",
         "Promise",
         "Awaited",
         "Parameters",
      ];
   }
   protected isEmpty(): boolean {
      return !hasRendererChannels(this.pfsArray);
   }
   protected renderEmptyFileContents(): string {
      return this.renderModule({ channels: [], imports: [], files: [] });
   }
   protected renderFileContents(): string {
      return this.renderModule(this.collectChannels());
   }
   /**
    * The file of the global: it takes the types from the types module, which is written next to
    * it for the same scope. Declares the error types only for the channels that can fail with them.
    */
   protected renderModule({ channels }: CollectedChannels): string {
      return renderDeclaration(
         channels,
         this.getDeclarationOptions(),
         this.importsGenerator.getFileImportPath(this.getTypesFilePath()),
      );
   }
   /**
    * Whether the file imports the types that only the errors of a channel use. They are named in
    * the `@throws` tag of the method, which TypeScript does not count as a use of the import.
    */
   protected importsErrorTypes(): boolean {
      return true;
   }
   protected collectChannels(): CollectedChannels {
      const imports: string[] = [];
      const channels: ChannelEntry[] = [];
      const files: ChannelsOfFile[] = [];

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();
         const names: string[] = [];

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            const channel = this.buildChannelEntry(spec);
            if (!channel) {
               continue;
            }
            channels.push(channel);
            names.push(spec.name);
            const specCustomTypes = new Set([
               ...spec.signature.customTypes,
               ...(this.importsErrorTypes() ? (spec.errors?.customTypes ?? []) : []),
            ]);
            customTypes = customTypes.union(specCustomTypes);
         }
         if (names.length > 0) {
            files.push({ pfs: parsedFileSpecs, names });
         }
         imports.push(...this.getImportDeclarations(parsedFileSpecs, customTypes));
      }
      return { channels, imports, files };
   }
   private getImportDeclarations(pfs: t.ParsedFileSpecs, customTypes: Set<string>): string[] {
      const declarations: string[] = [];
      for (const customType of customTypes) {
         const declaration = this.importsGenerator.getDeclaration(pfs, customType);
         if (declaration) {
            declarations.push(declaration);
         }
      }
      return declarations;
   }
   /** The isolated world that the API is exposed in, or `undefined` for the main world. */
   protected getWorldId(): number | undefined {
      return this.config.isolatedWorldId;
   }
   protected getDeclarationOptions(): DeclarationOptions {
      return {
         indents: this.indents,
         exposeAs: this.getExposeAs(),
         worldId: this.getWorldId(),
         scope: this.scope,
         pathForFile: this.getPathForFileEnabled(),
      };
   }
   /** The entry of a channel of the page, or `null` for the channels that the page has no part in. */
   protected buildChannelEntry(spec: t.ChannelSpec): ChannelEntry | null {
      if (isUtilitySpec(spec) || isWorkerSpec(spec)) {
         return null;
      } else if (spec.kind === "Port") {
         // The page has the same API for both peers: another page, or the main process.
         return this.buildPortChannel(spec);
      } else if (isBrokeredSpec(spec)) {
         return this.buildBrokeredChannel(spec);
      } else if (spec.kind === "Stream") {
         return this.buildStreamChannel(spec);
      } else if (spec.direction === "RendererToMain") {
         return this.buildRendererToMainChannel(spec);
      }
      return spec.direction === "MainToRenderer" ? this.buildMainToRendererChannel(spec) : null;
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
      const thrown = errorType ? `IpcError<${errorType}>` : "IpcError";
      const doc = `/** @throws {${thrown}} */`;
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
   /**
    * `ipc.<name>.invoke(...args)` and `ipc.<name>.stream(...args)` of the channels to a utility
    * process. They are typed like those of the main process, and can fail with the errors that the
    * handler of the child throws, and with an `IpcUtilityError` of the library.
    */
   private buildBrokeredChannel(spec: t.ChannelSpec): ChannelEntry {
      const signatureHead = `${this.getTypeParams(spec.signature)}(${this.getOriginalParams(spec, false)})`;
      const errorType = [spec.errors?.definition, "IpcUtilityError"].filter(Boolean).join(" | ");
      if (spec.kind === "Stream") {
         const chunk = spec.signature.chunkType ?? "unknown";
         const doc = `/** @throws {IpcError<${errorType}>} when the stream fails, from a read of the stream */`;
         return {
            name: spec.name,
            throws: true,
            streams: true,
            utility: true,
            methods: [this.method("stream", `${signatureHead} => IpcStream<${chunk}>`, doc)],
         };
      }
      // `invoke` always returns a promise, which resolves the thenables inside.
      const returned = spec.signature.async
         ? spec.signature.definition
         : `${signatureHead} => Promise<Awaited<${spec.signature.returnType}>>`;
      return {
         name: spec.name,
         throws: true,
         utility: true,
         methods: [this.method("invoke", returned, `/** @throws {IpcError<${errorType}>} */`)],
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
      const docLine = doc ? `\n${i1}${doc}` : "";
      return `${docLine}\n${i1}${name}: ${type};`;
   }
}
