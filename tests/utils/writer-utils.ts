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

import parser from "@src/parser.js";
import { BaseWriter } from "@src/writer/base-writer.js";
import writer from "@src/writer/index.js";
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
}

export class VitestMainBindingsWriter extends writer.MainBindingsWriter {
   constructor(pfsArray: t.ParsedFileSpecs[]) {
      super({ codeIndent: 3 } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestPreloadBindingsWriter extends writer.PreloadBindingsWriter {
   constructor(pfsArray: t.ParsedFileSpecs[]) {
      super({ codeIndent: 3 } as t.IPCResolvedConfig, pfsArray);
   }
   public getTargetFilePath(): string {
      return "";
   }
}

export class VitestRendererTypesWriter extends writer.RendererTypesWriter {
   constructor(pfsArray: t.ParsedFileSpecs[]) {
      super({ codeIndent: 3 } as t.IPCResolvedConfig, pfsArray);
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
export function parseTestSignature(definition: string, locals: string[] = []): t.CallableSignature {
   const { module, src } = parser.parseModule(`type T = ${definition};`);
   const alias = (module.body[0] as any).typeAnnotation;
   return parser.parseSignature(alias, src, new Set(locals));
}

export interface SimpleChannel {
   name: string;
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   /** Parameters as written in the signature, such as `"id: number"` or `"...rest: string[]"`. */
   params?: string[];
   returnType?: string;
   trigger?: string;
}

/**
 * Builds the file specs of a schema file from simple channel descriptors,
 * parsing the signatures the same way the parser does for real schema files.
 */
export function buildFileSpecs(...channels: SimpleChannel[]): t.ParsedFileSpecs[] {
   const channelSpecArray = channels.map((channel) => {
      const definition = `(${(channel.params ?? []).join(", ")}) => ${channel.returnType ?? "void"}`;
      const { module, src } = parser.parseModule(`type T = ${definition};`);
      const alias = (module.body[0] as any).typeAnnotation;
      const { trigger, params: _params, returnType: _returnType, ...rest } = channel;
      return { ...rest, signature: parser.parseSignature(alias, src), ...(trigger && { trigger }) };
   });
   return [
      {
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
   },
};
