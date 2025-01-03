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
      let paramName = param.name;
      if (param.rest) {
         paramName = `...${param.name}`;
      } else if (param.optional) {
         paramName = `${param.name}?`;
      }
      return `${paramName}: ${param.type}`;
   });
   const sigDefinition = `(${sigParams.join(", ")}) => ${vcs.sigReturnType}`;
   const channelSpec: Partial<t.ChannelSpec> = {
      name: "VitestChannel",
      kind: vcs.channelKind as t.ChannelKind,
      direction: vcs.channelDirection as t.ChannelDirection,
      signature: {
         definition: sigDefinition,
         params: sigParamsArray,
         returnType: vcs.sigReturnType,
         customTypes: vcs.sigCustomTypes,
         async: vcs.sigReturnType.includes("Promise"),
      } as t.CallableSignature,
   };
   if (vcs.channelListeners.length > 0) {
      Object.assign(channelSpec, { listeners: vcs.channelListeners });
   }
   return [
      {
         specs: {
            typeSpecArray: [],
            importSpecArray: [],
            channelSpecArray: [channelSpec] as Partial<t.ChannelSpec>[],
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
         channelListeners: ["onCustomListener1", "onCustomListener2"],
         paramType: "string",
         paramRest: false,
         paramOptional: false,
         sigReturnType: "void",
         sigCustomTypes: [],
      }),
      Broadcast_MainToRenderer: getParsedFileSpecsArray({
         channelKind: "Broadcast",
         channelDirection: "MainToRenderer",
         channelListeners: ["onCustomListener1", "onCustomListener2"],
         paramType: "number",
         paramRest: true,
         paramOptional: false,
         sigReturnType: "Promise<CustomType>",
         sigCustomTypes: ["CustomType"],
      }),
   },
};
