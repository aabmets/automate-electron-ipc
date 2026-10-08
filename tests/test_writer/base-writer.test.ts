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

import fsp from "node:fs/promises";
import { BaseWriter } from "@src/writer/base-writer.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("BaseWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestBaseWriter);

   it("should throw an error on abstract base class instantiation", () => {
      expect(() => {
         new BaseWriter({} as t.IPCResolvedConfig, []); // NOSONAR
      }).toThrowError("Cannot instantiate abstract base class");
   });

   it("should throw when a subclass does not implement the abstract methods", () => {
      class IncompleteWriter extends BaseWriter {}
      const config = { codeIndent: 3 } as t.IPCResolvedConfig;
      expect(() => new IncompleteWriter(config, [])).toThrowError(
         "Must implement method 'getTargetFilePath' in 'IncompleteWriter' class",
      );

      class PathOnlyWriter extends IncompleteWriter {
         protected getTargetFilePath(): string {
            return "";
         }
      }
      const writer = new PathOnlyWriter(config, []) as any;
      expect(() => writer.renderEmptyFileContents()).toThrowError(
         "Must implement method 'renderEmptyFileContents'",
      );
      expect(() => writer.renderFileContents()).toThrowError(
         "Must implement method 'generateFileContents'",
      );
   });

   it("should not throw an error on subclass instantiation", () => {
      new shared.VitestBaseWriter({} as t.IPCResolvedConfig, []); // NOSONAR
   });

   it("should generate code indents array", () => {
      for (const value of [2, 3, 4]) {
         const obj = new shared.VitestBaseWriter({ codeIndent: value } as t.IPCResolvedConfig, []);
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
      const result = shared.VitestBaseWriter.prototype.injectEventTypehint(sigDef);
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
      let result = shared.VitestBaseWriter.prototype.getOriginalParams(spec as t.ChannelSpec, true);
      expect(result).toStrictEqual("arg1, arg2");
      result = shared.VitestBaseWriter.prototype.getOriginalParams(spec as t.ChannelSpec, false);
      expect(result).toStrictEqual("arg1: number, arg2: string");
   });

   it("should sort callables array by prefixes and alphabetically", () => {
      const result = shared.VitestBaseWriter.prototype.sortCallablesArray([
         "sendEvent3",
         "onThirdEvent",
         "sendEvent2",
         "onFirstEvent",
         "sendEvent1",
         "onSecondEvent",
      ]);
      expect(result).toStrictEqual([
         "onFirstEvent",
         "onSecondEvent",
         "onThirdEvent",
         "sendEvent1",
         "sendEvent2",
         "sendEvent3",
      ]);
   });

   describe("channel specs of colliding type names", () => {
      const pfsOf = (
         fullPath: string,
         signature: Partial<t.CallableSignature>,
      ): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: {
            channelSpecArray: [
               {
                  name: "chan",
                  signature: {
                     customTypes: ["User"],
                     returnType: "void",
                     params: [],
                     ...signature,
                  },
               } as unknown as t.ChannelSpec,
            ],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [
               { name: "User", kind: "interface" as t.TypeKind, generics: null, isExported: true },
            ],
         },
      });
      const first = pfsOf("/project/a.ts", { definition: "() => User" });

      it("should return the specs as they are when no type name is taken", () => {
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first]);
         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
      });

      it("should rename the references of the colliding type in the signature", () => {
         const definition =
            "(User: User, list: Map<string, User>, o: { User: User; readonly User: User }, " +
            's: "User", n: NS.User, c: A extends B ? User : User[]) => Promise<User[]>';
         const second = pfsOf("/project/b.ts", {
            definition,
            returnType: "Promise<User[]>",
            params: [
               { name: "User", type: "User", rest: false, optional: false },
               { name: "list", type: "Map<string, User>", rest: false, optional: true },
            ],
         });
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);

         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
         const [spec] = obj.getChannelSpecs(second);
         expect(spec.signature.definition).toStrictEqual(
            "(User: User_2, list: Map<string, User_2>, o: { User: User_2; readonly User: User_2 }, " +
               's: "User", n: NS.User, c: A extends B ? User_2 : User_2[]) => Promise<User_2[]>',
         );
         expect(spec.signature.returnType).toStrictEqual("Promise<User_2[]>");
         expect(spec.signature.params).toStrictEqual([
            { name: "User", type: "User_2", rest: false, optional: false },
            { name: "list", type: "Map<string, User_2>", rest: false, optional: true },
         ]);
         expect(spec.signature.customTypes).toStrictEqual(["User"]);
         // The parsed spec is not modified.
         expect(second.specs.channelSpecArray[0].signature.returnType).toStrictEqual(
            "Promise<User[]>",
         );
      });
   });

   it("should render empty file contents when pfsArray is empty", async () => {
      const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, []);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      expect(buffer.toString()).toStrictEqual("EMPTY FILE");
   });

   it("should render file contents when pfsArray is not empty", async () => {
      const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [{} as t.ParsedFileSpecs]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      expect(buffer.toString()).toStrictEqual("const asdfg = 123;");
   });

   it("should prepend the generated-file notice, without the stale 'PLUGIN' wording", async () => {
      const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [{} as t.ParsedFileSpecs]);
      await obj.write(true);
      const text = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(text.trimStart()).toStrictEqual(
         [
            "// NOTICE: THIS FILE WAS GENERATED BY AUTOMATE-ELECTRON-IPC.",
            "// ANY CHANGES TO THIS FILE WILL NOT PERSIST BETWEEN GENERATIONS.",
            "",
            "const asdfg = 123;",
         ].join("\n"),
      );
      expect(text).not.toContain("PLUGIN");
   });
});
