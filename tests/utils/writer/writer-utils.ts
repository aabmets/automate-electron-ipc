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

import { parseModule } from "@src/parser/ast.js";
import { parseSignature } from "@src/parser/type/signature.js";
import { BaseWriter } from "@src/writer/base-writer.js";
import { MainBindingsWriter } from "@src/writer/main/main-bindings.js";
import { PreloadBindingsWriter } from "@src/writer/preload/preload-bindings.js";
import { ServiceWorkerPreloadWriter } from "@src/writer/preload/service-worker-preload.js";
import { RendererTypesWriter } from "@src/writer/renderer/renderer-types.js";
import { ServiceWorkerTypesWriter } from "@src/writer/renderer/service-worker-types.js";
import { UtilityBindingsWriter } from "@src/writer/utility/utility-bindings.js";
import type * as t from "@types";

export class VitestBaseWriter extends BaseWriter {
   public getTargetFilePath(): string {
      return "";
   }
   public renderEmptyFileContents(): string {
      return "EMPTY FILE";
   }
   public renderFileContents(): string {
      return "const asdfg = 123;";
   }
   public getCodeIndents(): string[] {
      return super.getCodeIndents();
   }
   public joinComponents(components: string[]): string {
      return super.joinComponents(components);
   }
   public injectEventTypehint(
      signature: t.CallableSignature,
      eventType: string,
      eventName?: string,
   ): string {
      return super.injectEventTypehint(signature, eventType, eventName);
   }
   public getTypeParams(signature: t.CallableSignature): string {
      return super.getTypeParams(signature);
   }
   public getOriginalParams(spec: t.ChannelSpec, withTypes: boolean): string {
      return super.getOriginalParams(spec, withTypes);
   }
   public sortChannels<T extends { name: string }>(channels: T[]): T[] {
      return super.sortChannels(channels);
   }
   public getChannelSpecs(parsedFileSpecs: t.ParsedFileSpecs): t.ChannelSpec[] {
      return super.getChannelSpecs(parsedFileSpecs);
   }
   public getScopedFilePath(filePath: string): string {
      return super.getScopedFilePath(filePath);
   }
}

export class VitestMainBindingsWriter extends MainBindingsWriter {
   constructor(pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig> = {}) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestPreloadBindingsWriter extends PreloadBindingsWriter {
   constructor(
      pfsArray: t.ParsedFileSpecs[],
      config: Partial<t.IPCResolvedConfig> = {},
      scope: string | null = null,
   ) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray, scope);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestRendererTypesWriter extends RendererTypesWriter {
   constructor(
      pfsArray: t.ParsedFileSpecs[],
      config: Partial<t.IPCResolvedConfig> = {},
      scope: string | null = null,
   ) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray, scope);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestUtilityBindingsWriter extends UtilityBindingsWriter {
   constructor(pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig> = {}) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestServiceWorkerPreloadWriter extends ServiceWorkerPreloadWriter {
   constructor(pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig> = {}) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestServiceWorkerTypesWriter extends ServiceWorkerTypesWriter {
   constructor(pfsArray: t.ParsedFileSpecs[], config: Partial<t.IPCResolvedConfig> = {}) {
      super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

/**
 * Builds the file specs of one channel, with a signature that the parser produces from
 * `(arg1: T, arg2: T) => R`, where the second parameter may be rest or optional.
 */
function getParsedFileSpecsArray(vcs: t.VitestChannelSpec): t.ParsedFileSpecs[] {
   const second = vcs.paramRest ? "...arg2" : vcs.paramOptional ? "arg2?" : "arg2";
   const secondType = vcs.paramRest ? `${vcs.paramType}[]` : vcs.paramType;
   const definition = `(arg1: ${vcs.paramType}, ${second}: ${secondType}) => ${vcs.sigReturnType}`;
   const channelSpec: t.ChannelSpec = {
      name: "vitestChannel",
      kind: vcs.channelKind as t.ChannelKind,
      direction: vcs.channelDirection as t.ChannelDirection,
      signature: parseTestSignature(definition),
   };
   return [
      {
         fullPath: "/project/ipc/schema.ts",
         relativePath: "schema.ts",
         specs: {
            typeSpecArray: [],
            importSpecArray: [],
            channelSpecArray: [channelSpec],
            channelMapExport: { kind: "default" },
         },
      },
   ];
}

/** Parses a signature text the same way the parser does for real schema files. */
export function parseTestSignature(
   definition: string,
   locals: string[] = [],
   streaming = false,
): t.CallableSignature {
   const { module, src } = parseModule(`type T = ${definition};`);
   const alias = (module.body[0] as any).typeAnnotation;
   return parseSignature(alias, src, new Set(locals), new Map(), streaming);
}

export interface SimpleChannel {
   name: string;
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   /** Parameters as written in the signature, such as `"id: number"` or `"...rest: string[]"`. */
   params?: string[];
   returnType?: string;
   trigger?: string;
   allowedOrigins?: string[];
   validate?: t.ValidatorRef;
   /** The size of the send queues of a port channel. */
   maxQueue?: number;
   /** The most unread chunks of a stream channel, or `Infinity`. */
   highWaterMark?: number;
   /** The timeout of an invoke channel in milliseconds. */
   timeoutMs?: number;
   /** The error types of an invoke or stream channel, such as `"NotFoundError | AuthError"`. */
   errors?: string;
   /** The scopes of the channel. */
   scopes?: string[];
}

/**
 * Builds the file specs of a schema file from simple channel descriptors,
 * parsing the signatures the same way the parser does for real schema files.
 */
export function buildFileSpecs(...channels: SimpleChannel[]): t.ParsedFileSpecs[] {
   const channelSpecArray = channels.map((channel) => {
      const definition = `(${(channel.params ?? []).join(", ")}) => ${channel.returnType ?? "void"}`;
      const { module, src } = parseModule(`type T = ${definition};`);
      const alias = (module.body[0] as any).typeAnnotation;
      const { trigger, errors, params: _params, returnType: _returnType, ...rest } = channel;
      return {
         ...rest,
         signature: parseSignature(alias, src, new Set(), new Map(), channel.kind === "Stream"),
         ...(trigger && { trigger }),
         ...(errors && { errors: { definition: errors, customTypes: [] } }),
      };
   });
   return [
      {
         fullPath: "/project/ipc/schema.ts",
         relativePath: "schema.ts",
         specs: { typeSpecArray: [], importSpecArray: [], channelSpecArray },
      } as unknown as t.ParsedFileSpecs,
   ];
}

export default {
   buildFileSpecs,
   parseTestSignature,
   VitestBaseWriter,
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestRendererTypesWriter,
   VitestUtilityBindingsWriter,
   VitestServiceWorkerPreloadWriter,
   VitestServiceWorkerTypesWriter,
   vitestChannelSpecs: {
      Unicast_RendererToMain: getParsedFileSpecsArray({
         channelKind: "Unicast",
         channelDirection: "RendererToMain",
         paramType: "CustomType",
         paramRest: false,
         paramOptional: true,
         sigReturnType: "Promise<string>",
      }),
      Broadcast_RendererToMain: getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "RendererToMain",
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
      }),
      Broadcast_MainToRenderer: getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "MainToRenderer",
         paramType: "number",
         paramRest: true,
         paramOptional: false,
         sigReturnType: "Promise<CustomType>",
      }),
      Port_RendererToRenderer: getParsedFileSpecsArray({
         channelKind: "Port",
         channelDirection: "RendererToRenderer",
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
      }),
      Port_MainToRenderer: getParsedFileSpecsArray({
         channelKind: "Port",
         channelDirection: "MainToRenderer",
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
      }),
   },
};
