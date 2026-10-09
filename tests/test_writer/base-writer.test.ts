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
import { describe, expect, it, vi } from "vitest";

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
            "      ".repeat(value),
         ]);
      }
   });

   it("should inject the event typehint at the start of the parameter list", () => {
      const writer = shared.VitestBaseWriter.prototype;
      const sign = (definition: string, params: number) =>
         ({
            definition,
            paramsStart: definition.indexOf("(") + 1,
            params: new Array(params),
         }) as unknown as t.CallableSignature;

      expect(writer.injectEventTypehint(sign("(arg1: number) => boolean", 1), "IpcMainEvent")).toBe(
         "(event: IpcMainEvent, arg1: number) => boolean",
      );
      expect(
         writer.injectEventTypehint(sign("() => void", 0), "IpcMainInvokeEvent", "_event"),
      ).toBe("(_event: IpcMainInvokeEvent) => void");
   });

   // Regression for T57: the event was inserted at the first `(` of the text.
   it("should not insert the event into the constraint of a type parameter", () => {
      const signature = {
         definition: "<T extends (x: number) => void>(cb: T) => void",
         paramsStart: 32,
         params: [{}],
      } as unknown as t.CallableSignature;
      const writer = shared.VitestBaseWriter.prototype;
      expect(writer.injectEventTypehint(signature, "IpcMainEvent")).toBe(
         "<T extends (x: number) => void>(event: IpcMainEvent, cb: T) => void",
      );
      expect(writer.getTypeParams(signature)).toBe("<T extends (x: number) => void>");
   });

   it("should join components with at most one blank line between them", () => {
      const writer = shared.VitestBaseWriter.prototype;

      expect(writer.joinComponents([])).toBe("");
      expect(writer.joinComponents(["a", "b"])).toBe("a\nb");
      expect(writer.joinComponents(["a\n", "b"])).toBe("a\n\nb");
      expect(writer.joinComponents(["a", "\nb"])).toBe("a\n\nb");
      // Regression for T100: the newlines of both sides added up to two blank lines.
      expect(writer.joinComponents(["a\n", "\nb"])).toBe("a\n\nb");
      expect(writer.joinComponents(["a\n\n", "\n\nb\n"])).toBe("a\n\nb\n");
      expect(writer.joinComponents(["a\n", "", "\nb", ""])).toBe("a\n\nb\n");
      // The text inside a component is kept as it is.
      expect(writer.joinComponents(["\n\na\n\n\nb", "c\n\n\nd\n"])).toBe(
         "\n\na\n\n\nb\nc\n\n\nd\n",
      );
   });

   it("should return no type parameters for a plain signature", () => {
      const signature = { definition: "(a: string) => void", paramsStart: 1 };
      expect(
         shared.VitestBaseWriter.prototype.getTypeParams(signature as t.CallableSignature),
      ).toBe("");
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

   it("should forward rest parameters with their spread", () => {
      // Regression for B4: the spread was dropped, so the renderer received one array argument.
      const spec = {
         signature: {
            params: [
               { name: "first", type: "string", rest: false, optional: false },
               { name: "maybe", type: "number", rest: false, optional: true },
               { name: "values", type: "number[]", rest: true, optional: false },
            ],
         },
      } as t.ChannelSpec;
      const writer = shared.VitestBaseWriter.prototype;
      expect(writer.getOriginalParams(spec, true)).toStrictEqual("first, maybe, ...values");
      expect(writer.getOriginalParams(spec, false)).toStrictEqual(
         "first: string, maybe?: number, ...values: number[]",
      );
   });

   it("should replace destructured parameters with names that clash with nothing", () => {
      const spec = {
         signature: {
            params: [
               { name: "{ a, b }", type: "Point", rest: false, optional: false },
               { name: "[arg1, arg2]", type: "number[]", rest: false, optional: false },
               { name: "arg0", type: "string", rest: false, optional: false },
            ],
         },
      } as t.ChannelSpec;
      const writer = shared.VitestBaseWriter.prototype;
      expect(writer.getOriginalParams(spec, true)).toStrictEqual("_arg0, _arg1, arg0");
      expect(writer.getOriginalParams(spec, false)).toStrictEqual(
         "_arg0: Point, _arg1: number[], arg0: string",
      );
   });

   describe("sortChannels, order by name in code unit order", () => {
      const sort = (...names: string[]) =>
         shared.VitestBaseWriter.prototype
            .sortChannels(names.map((name) => ({ name })))
            .map((channel) => channel.name);

      // Regression for T67: whole callables were compared with `localeCompare`.
      it("puts a name before the same name with a suffix", () => {
         expect(sort("getFoo2", "getFoo")).toStrictEqual(["getFoo", "getFoo2"]);
      });

      it("orders upper case before lower case, digits before letters and underscores in between", () => {
         expect(sort("b", "B", "_a", "a", "A", "1")).toStrictEqual(["1", "A", "B", "_a", "a", "b"]);
      });

      it("orders non-ASCII letters after ASCII ones, as the code units do", () => {
         expect(sort("Ärlig", "Zeta", "Åland", "Apple")).toStrictEqual([
            "Apple",
            "Zeta",
            "Ärlig",
            "Åland",
         ]);
      });

      it("does not use the locale of the process", () => {
         const spy = vi.spyOn(String.prototype, "localeCompare");
         try {
            expect(sort("Ä", "Z")).toStrictEqual(["Z", "Ä"]);
            expect(spy).not.toHaveBeenCalled();
         } finally {
            spy.mockRestore();
         }
      });
   });

   describe("channel specs of colliding type names", () => {
      const pfsOf = (fullPath: string, definition: string): t.ParsedFileSpecs => ({
         fullPath,
         relativePath: "",
         specs: {
            channelSpecArray: [
               {
                  name: "chan",
                  signature: shared.parseTestSignature(definition),
               } as unknown as t.ChannelSpec,
            ],
            channelMapExport: null,
            importSpecArray: [],
            typeSpecArray: [
               { name: "User", kind: "interface" as t.TypeKind, generics: null, isExported: true },
            ],
         },
      });
      const first = pfsOf("/project/a.ts", "() => User");
      const renamed = (definition: string) => {
         const second = pfsOf("/project/b.ts", definition);
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         // The first file takes the name `User`, so the second one is renamed.
         obj.getChannelSpecs(first);
         return obj.getChannelSpecs(second)[0].signature;
      };

      it("should return the specs as they are when no type name is taken", () => {
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first]);
         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
      });

      it("should rename the references of the colliding type in the signature", () => {
         const definition =
            "(User: User, list?: Map<string, User>, o: { User: User; readonly User: User }, " +
            's: "User", n: NS.User, c: A extends B ? User : User[]) => Promise<User[]>';
         const second = pfsOf("/project/b.ts", definition);
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);

         expect(obj.getChannelSpecs(first)).toBe(first.specs.channelSpecArray);
         const [spec] = obj.getChannelSpecs(second);
         expect(spec.signature.definition).toStrictEqual(
            "(User: User_2, list?: Map<string, User_2>, o: { User: User_2; readonly User: User_2 }, " +
               's: "User", n: NS.User, c: A extends B ? User_2 : User_2[]) => Promise<User_2[]>',
         );
         expect(spec.signature.returnType).toStrictEqual("Promise<User_2[]>");
         expect(spec.signature.params.slice(0, 2)).toMatchObject([
            { name: "User", type: "User_2", rest: false, optional: false },
            { name: "list", type: "Map<string, User_2>", rest: false, optional: true },
         ]);
         expect(spec.signature.params[3].type).toStrictEqual('"User"');
         expect(spec.signature.customTypes).toStrictEqual(["User", "NS.User", "A", "B"]);
         // The parsed spec is not modified.
         expect(second.specs.channelSpecArray[0].signature.returnType).toStrictEqual(
            "Promise<User[]>",
         );
      });

      it("should rename the references in the chunk type of a stream signature", () => {
         const second = pfsOf("/project/b.ts", "() => AsyncIterable<User>");
         const spec = second.specs.channelSpecArray[0];
         spec.signature = shared.parseTestSignature("() => AsyncIterable<User>", [], true);
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         obj.getChannelSpecs(first);
         const { signature } = obj.getChannelSpecs(second)[0];

         expect(signature.definition).toBe("() => AsyncIterable<User_2>");
         expect(signature.returnType).toBe("AsyncIterable<User_2>");
         expect(signature.chunkType).toBe("User_2");
         // The parsed spec is not modified.
         expect(spec.signature.chunkType).toBe("User");
      });

      // Regression for T69: the `${...}` part of a template literal type was skipped as a string.
      it("should rename a reference inside a template literal type", () => {
         const signature = renamed("(key: `k-${User}`, u: User) => `${User}-v`");
         expect(signature.definition).toBe("(key: `k-${User_2}`, u: User_2) => `${User_2}-v`");
         expect(signature.params[0].type).toBe("`k-${User_2}`");
         expect(signature.returnType).toBe("`${User_2}-v`");
      });

      it("should not rename the text of a template literal outside of `${}`", () => {
         expect(renamed("(key: `User-${User}-User`) => void").definition).toBe(
            "(key: `User-${User_2}-User`) => void",
         );
      });

      // Regression for T69: the member name of a method type was renamed.
      it("should not rename the name of a method or an accessor", () => {
         const signature = renamed("(o: { User(): User; get User(): User; User?: User }) => void");
         expect(signature.definition).toBe(
            "(o: { User(): User_2; get User(): User_2; User?: User_2 }) => void",
         );
      });

      it("should rename a type in the type parameters and shift the start of the parameters", () => {
         const signature = renamed("<T extends User = User>(a: T) => T");
         expect(signature.definition).toBe("<T extends User_2 = User_2>(a: T) => T");
         expect(signature.definition.slice(signature.paramsStart)).toBe("a: T) => T");
      });

      it("should rename the head of a qualified name and a typeof query, not the rest", () => {
         const signature = renamed("(a: User.Kind, b: typeof User, c: typeof User.value) => void");
         expect(signature.definition).toBe(
            "(a: User_2.Kind, b: typeof User_2, c: typeof User_2.value) => void",
         );
      });

      it("should not rename a type parameter that shadows the colliding type", () => {
         const signature = renamed("<User>(a: User) => User");
         expect(signature.definition).toBe("<User>(a: User) => User");
      });

      it("should leave the texts alone for a signature without the offsets of the parser", () => {
         const second = pfsOf("/project/b.ts", "(a: User) => User");
         const {
            typeRefs: _refs,
            returnStart: _r,
            ...bare
         } = second.specs.channelSpecArray[0].signature;
         bare.params = bare.params.map(({ typeStart: _t, ...param }) => param);
         second.specs.channelSpecArray[0].signature = bare;
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [first, second]);
         obj.getChannelSpecs(first);
         expect(obj.getChannelSpecs(second)[0].signature).toMatchObject({
            returnType: "User",
            params: [{ type: "User" }],
         });
      });

      it("should rename correctly after non-ASCII text", () => {
         const signature = renamed('(k: "é日本", a: User) => User');
         expect(signature.definition).toBe('(k: "é日本", a: User_2) => User_2');
         expect(signature.params[1].type).toBe("User_2");
         expect(signature.returnType).toBe("User_2");
      });
   });

   // Regression for T89: the path of an import type is relative to the schema file, and was
   // copied as it is into the generated files.
   describe("import types in signatures", () => {
      class InIpcDir extends shared.VitestBaseWriter {
         public getTargetFilePath(): string {
            return "/project/ipc/main.ts";
         }
      }
      const channelsOf = (fullPath: string, definition: string, nodeNext = false) => {
         const pfs: t.ParsedFileSpecs = {
            fullPath,
            relativePath: "",
            specs: {
               channelSpecArray: [
                  {
                     name: "chan",
                     signature: shared.parseTestSignature(definition),
                  } as unknown as t.ChannelSpec,
               ],
               channelMapExport: null,
               importSpecArray: [],
               typeSpecArray: [],
            },
         };
         const config = { projectUsesNodeNext: nodeNext } as t.IPCResolvedConfig;
         return new InIpcDir(config, [pfs]).getChannelSpecs(pfs)[0].signature;
      };

      it("should rebase the path to the directory of the generated file", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./models").User) => Promise<typeof import("../shared/x.mjs")>',
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/models").User) => Promise<typeof import("./shared/x.mjs")>',
         );
         expect(signature.params[0].type).toBe('import("./schema/models").User');
         expect(signature.returnType).toBe('Promise<typeof import("./shared/x.mjs")>');
         expect(signature.definition.slice(signature.paramsStart)).toBe(
            'a: import("./schema/models").User) => Promise<typeof import("./shared/x.mjs")>',
         );
      });

      it("should add the script extension for NodeNext", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./models").User, b: import("./data.json")) => void',
            true,
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/models.js").User, b: import("./schema/data.json")) => void',
         );
      });

      it("should keep the specifier of a package", () => {
         const spec = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("zod").ZodType) => void',
         );
         expect(spec.definition).toBe('(a: import("zod").ZodType) => void');
      });

      it("should rebase the path in the type arguments of an import type", () => {
         const signature = channelsOf(
            "/project/ipc/schema/api.ts",
            '(a: import("./a").Box<import("./b").Item>) => void',
         );
         expect(signature.definition).toBe(
            '(a: import("./schema/a").Box<import("./schema/b").Item>) => void',
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
      // Regression for T65: the file started with a blank line.
      expect(text).toStrictEqual(
         [
            "// NOTICE: THIS FILE WAS GENERATED BY AUTOMATE-ELECTRON-IPC.",
            "// ANY CHANGES TO THIS FILE WILL NOT PERSIST BETWEEN GENERATIONS.",
            "",
            "const asdfg = 123;",
         ].join("\n"),
      );
      expect(text).not.toContain("PLUGIN");
   });

   describe("scope", () => {
      it("writes the files of no scope to the path that it is given", () => {
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, []);
         expect(obj.getScopedFilePath("/p/ipc/preload.ts")).toBe("/p/ipc/preload.ts");
      });

      it("names the file of a scope after it, in front of the extension", () => {
         const obj = new shared.VitestBaseWriter({} as t.IPCResolvedConfig, [], "settings");
         expect(obj.getScopedFilePath("/p/ipc/preload.ts")).toBe("/p/ipc/preload.settings.ts");
         expect(obj.getScopedFilePath("/p/ipc/window.d.ts")).toBe("/p/ipc/window.settings.d.ts");
      });
   });
});
