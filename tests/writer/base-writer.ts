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
import type * as t from "@types";
import { describe, expect, it } from "vitest";

class WriterSubclass extends BaseWriter {
   public getTargetFilePath(): string {
      return "/abstract/file/path";
   }
   public renderEmptyFileContents(): string {
      return "";
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

describe("BaseWriter", () => {
   it("should throw an error on abstract base class instantiation", () => {
      expect(() => {
         new BaseWriter({} as t.IPCResolvedConfig, []);
      }).toThrowError("Cannot instantiate abstract base class");
   });

   it("should not throw an error on subclass instantiation", () => {
      new WriterSubclass({} as t.IPCResolvedConfig, []);
   });

   it("should generate code indents array", () => {
      for (const value of [2, 3, 4]) {
         const obj = new WriterSubclass({ codeIndent: value } as t.IPCResolvedConfig, []);
         expect(obj.getCodeIndents()).toStrictEqual([
            " ".repeat(value),
            "  ".repeat(value),
            "   ".repeat(value),
            "    ".repeat(value),
            "     ".repeat(value),
         ]);
      }
   });

   it("should inject IpcMainEvent typehint", () => {
      const sigDef = "(arg1: number, arg2: string) => boolean";
      const result = WriterSubclass.prototype.injectEventTypehint(sigDef);
      expect(result).toStrictEqual("(event: IpcMainEvent, arg1: number, arg2: string) => boolean");
   });

   it("should stringify CallableParam objects with and without types", () => {
      const spec = {
         signature: {
            params: [
               {
                  name: "arg1",
                  type: "number",
               },
               {
                  name: "arg2",
                  type: "string",
               },
            ] as Partial<t.CallableParam>[],
         } as Partial<t.CallableSignature>,
      } as Partial<t.ChannelSpec>;
      let result = WriterSubclass.prototype.getOriginalParams(spec as t.ChannelSpec, false);
      expect(result).toStrictEqual("arg1, arg2");
      result = WriterSubclass.prototype.getOriginalParams(spec as t.ChannelSpec, true);
      expect(result).toStrictEqual("arg1: number, arg2: string");
   });
});
