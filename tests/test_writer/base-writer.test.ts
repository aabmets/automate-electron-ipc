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

import { notice } from "@src/output-files.js";
import { BaseWriter } from "@src/writer/base-writer.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestBaseWriter } from "@testutils/writer/test-writers.js";
import type * as t from "@types";
import { describe, expect, it, vi } from "vitest";

describe("BaseWriter", () => {
   mockGetTargetFilePath(VitestBaseWriter);

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
      new VitestBaseWriter({} as t.IPCResolvedConfig, []); // NOSONAR
   });

   it("should generate code indents array", () => {
      for (const value of [2, 3, 4]) {
         const obj = new VitestBaseWriter({ codeIndent: value } as t.IPCResolvedConfig, []);
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
      const writer = VitestBaseWriter.prototype;
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
      const writer = VitestBaseWriter.prototype;
      expect(writer.injectEventTypehint(signature, "IpcMainEvent")).toBe(
         "<T extends (x: number) => void>(event: IpcMainEvent, cb: T) => void",
      );
      expect(writer.getTypeParams(signature)).toBe("<T extends (x: number) => void>");
   });

   it("should join components with at most one blank line between them", () => {
      const writer = VitestBaseWriter.prototype;

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
      expect(VitestBaseWriter.prototype.getTypeParams(signature as t.CallableSignature)).toBe("");
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
      let result = VitestBaseWriter.prototype.getOriginalParams(spec as t.ChannelSpec, true);
      expect(result).toStrictEqual("arg1, arg2");
      result = VitestBaseWriter.prototype.getOriginalParams(spec as t.ChannelSpec, false);
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
      const writer = VitestBaseWriter.prototype;
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
      const writer = VitestBaseWriter.prototype;
      expect(writer.getOriginalParams(spec, true)).toStrictEqual("_arg0, _arg1, arg0");
      expect(writer.getOriginalParams(spec, false)).toStrictEqual(
         "_arg0: Point, _arg1: number[], arg0: string",
      );
   });

   describe("sortChannels, order by name in code unit order", () => {
      const sort = (...names: string[]) =>
         VitestBaseWriter.prototype
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

   it("should render empty file contents when pfsArray is empty", () => {
      const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, []);
      expect(obj.render(false)).toStrictEqual("EMPTY FILE");
   });

   it("should render file contents when pfsArray is not empty", () => {
      const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [{} as t.ParsedFileSpecs]);
      expect(obj.render(false)).toStrictEqual("const asdfg = 123;");
   });

   it("should prepend the generated-file notice, without the stale 'PLUGIN' wording", () => {
      const config = { projectRoot: "/p", ipcSchema: { path: "/p/ipc/schema.ts" } };
      const obj = new VitestBaseWriter(config as t.IPCResolvedConfig, [{} as t.ParsedFileSpecs]);
      const text = obj.render();
      // Regression for T65: the file started with a blank line.
      expect(text).toStrictEqual(`${notice(config as t.IPCResolvedConfig)}\n\nconst asdfg = 123;`);
      expect(text).not.toContain("PLUGIN");
   });

   it("should describe the file as a run writes it, with a posix path and the notice", () => {
      const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [{} as t.ParsedFileSpecs]);
      vi.spyOn(obj, "getTargetFilePath").mockReturnValue("C:\\p\\ipc\\main.ts");
      expect(obj.toOutputFile()).toStrictEqual({
         path: "C:/p/ipc/main.ts",
         contents: obj.render(),
      });
   });

   describe("scope", () => {
      it("writes the files of no scope to the path that it is given", () => {
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, []);
         expect(obj.getScopedFilePath("/p/ipc/preload.ts")).toBe("/p/ipc/preload.ts");
      });

      it("names the file of a scope after it, in front of the extension", () => {
         const obj = new VitestBaseWriter({} as t.IPCResolvedConfig, [], "settings");
         expect(obj.getScopedFilePath("/p/ipc/preload.ts")).toBe("/p/ipc/preload.settings.ts");
         expect(obj.getScopedFilePath("/p/ipc/window.d.ts")).toBe("/p/ipc/window.settings.d.ts");
      });
   });
});
