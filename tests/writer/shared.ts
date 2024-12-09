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
   public injectEventTypehint(sigDef: string): string {
      return super.injectEventTypehint(sigDef);
   }
   public getOriginalParams(spec: t.ChannelSpec, withTypes: boolean): string {
      return super.getOriginalParams(spec, withTypes);
   }
   public sortCallablesArray(callablesArray: string[]): string[] {
      return super.sortCallablesArray(callablesArray);
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

function getParsedFileSpecsArray(vcs: t.VitestChannelSpec): t.ParsedFileSpecs[] {
   const sigParamsArray: t.CallableParam[] = [1, 2].map((index) => {
      return {
         name: `arg${index}`,
         type: vcs.paramType,
         rest: vcs.paramRest && index === 2,
         optional: vcs.paramOptional && index === 2,
      };
   });
   const sigParams = sigParamsArray.map((param) => {
      const paramName = param.rest
         ? `...${param.name}`
         : param.optional
           ? `${param.name}?`
           : param.name;
      return `${paramName}: ${param.type}`;
   });
   const sigDefinition = `(${sigParams.join(", ")}) => ${vcs.sigReturnType}`;
   return [
      {
         specs: {
            typeSpecArray: [],
            importSpecArray: [],
            channelSpecArray: [
               {
                  name: "VitestChannel",
                  kind: vcs.channelKind as t.ChannelKind,
                  direction: vcs.channelDirection as t.ChannelDirection,
                  listeners: vcs.channelListeners,
                  signature: {
                     definition: sigDefinition,
                     params: sigParamsArray,
                     returnType: vcs.sigReturnType,
                     customTypes: vcs.sigCustomTypes,
                  } as t.CallableSignature,
               } as Partial<t.ChannelSpec>,
            ] as Partial<t.ChannelSpec>[],
         } as Partial<t.SpecsCollection>,
      } as Partial<t.ParsedFileSpecs>,
   ] as t.ParsedFileSpecs[];
}

export default {
   VitestBaseWriter,
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestRendererTypesWriter,
   vitestChannelSpecs: {
      Unicast_RendererToMain: getParsedFileSpecsArray({
         channelKind: "Unicast",
         channelDirection: "RendererToMain",
         channelListeners: [],
         paramType: "CustomType",
         paramRest: false,
         paramOptional: true,
         sigReturnType: "Promise<string>",
         sigCustomTypes: ["CustomType"],
      }),
      Broadcast_RendererToMain: getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "RendererToMain",
         channelListeners: [],
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
         sigCustomTypes: [],
      }),
      Broadcast_MainToRenderer: getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "MainToRenderer",
         channelListeners: [],
         paramType: "number",
         paramRest: true,
         paramOptional: false,
         sigReturnType: "Promise<CustomType>",
         sigCustomTypes: ["CustomType"],
      }),
   },
};
