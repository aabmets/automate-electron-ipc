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

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BaseWriter } from "@src/writer/base-writer.js";
import writer from "@src/writer/index.js";
import type * as t from "@types";
import { MockInstance, afterAll, afterEach, beforeEach, vitest } from "vitest";

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
   public getTargetFilePath(): string {
      return "";
   }
}
export class VitestPreloadBindingsWriter extends writer.PreloadBindingsWriter {
   public getTargetFilePath(): string {
      return "";
   }
}
export class VitestRendererTypesWriter extends writer.RendererTypesWriter {
   public getTargetFilePath(): string {
      return "";
   }
}

export function mockGetTargetFilePath<T extends new (...args: any[]) => BaseWriter>(cls: T) {
   let spy: MockInstance;
   const dirName = `vitest-${crypto.randomBytes(8).toString("hex")}`;

   beforeEach(() => {
      spy = vitest.spyOn(cls.prototype, "getTargetFilePath");
      const fileName = `testfile-${crypto.randomBytes(8).toString("hex")}`;
      spy.mockImplementation(() => {
         return path.join(tmpdir(), dirName, fileName);
      });
   });
   afterEach(() => spy.mockRestore());
   afterAll(async () => {
      const dirPath = path.join(tmpdir(), dirName);
      await fsp.rm(dirPath, { recursive: true, force: true });
   });
}

export function getParsedFileSpecsArray(vcs: t.VitestChannelSpec): Partial<t.ParsedFileSpecs>[] {
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
   ] as Partial<t.ParsedFileSpecs>[];
}

export default {
   VitestBaseWriter,
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestRendererTypesWriter,
   mockGetTargetFilePath,
   getParsedFileSpecsArray,
};
