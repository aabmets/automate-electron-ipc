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

import { parseModule } from "@src/ast.js";
import { describeSyntaxError } from "@src/diagnostics.js";
import { describe, expect, it } from "vitest";

describe("describeSyntaxError", () => {
   it("reads the position from the caret of the code frame", () => {
      const message = [
         "  x Expression expected",
         "   ,-[2:1]",
         " 1 | const a = 1;",
         " 2 | export default f({ a: ;",
         "   :                       ^",
         " 3 | });",
         "   `----",
      ].join("\n");
      expect(describeSyntaxError(new Error(message))).toStrictEqual({
         reason: "Expression expected",
         line: 2,
         column: 23,
      });
   });

   // Regression for T71: the column was read from the frame, which expands tabs and counts the
   // display width of wide characters.
   describe("with the parsed source", () => {
      const describeError = (code: string) => {
         try {
            parseModule(code);
         } catch (error) {
            return describeSyntaxError(error, code);
         }
         throw new Error("Expected a syntax error");
      };

      it("counts a tab as one column", () => {
         expect(describeError("\tconst b = ;")).toMatchObject({ line: 1, column: 12 });
         expect(describeError("x\t=\t;")).toMatchObject({ line: 1, column: 5 });
         expect(describeError("\t\tconst b = ;")).toMatchObject({ line: 1, column: 13 });
      });

      it("counts a wide character as one column", () => {
         expect(describeError('const s = "日本"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("counts a character outside the BMP as two columns, like an editor", () => {
         expect(describeError('const s = "😀"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("counts a combining mark as a column", () => {
         expect(describeError('const s = "e\u0301"; const b = ;')).toMatchObject({
            line: 1,
            column: 27,
         });
      });

      it("reads the line of an error after several lines, with CRLF line ends", () => {
         expect(describeError("const a = 1;\r\n\r\n\tconst b = ;\r\n")).toMatchObject({
            line: 3,
            column: 12,
         });
      });

      it("does not count a BOM", () => {
         expect(describeError("\uFEFFconst b = ;")).toMatchObject({ line: 1, column: 11 });
         expect(describeError("\uFEFF\tconst b = ;")).toMatchObject({ line: 1, column: 12 });
      });

      it("gives an error at the end of the input the position of the end", () => {
         expect(describeError("const a = 1;\nconst b = ")).toMatchObject({ line: 2, column: 11 });
         expect(describeError("const a = (")).toMatchObject({ line: 1, column: 12 });
         expect(describeError("type T = ")).toMatchObject({ line: 1, column: 10 });
         expect(describeError("const a = (\n")).toMatchObject({ line: 2, column: 1 });
      });

      it("falls back to the display column when the frame does not match the source", () => {
         const message = ["  x Oops", "   ,----", " 1 | const b = ;", "   :           ^"].join(
            "\n",
         );
         expect(describeSyntaxError(new Error(message), "different")).toMatchObject({
            line: 1,
            column: 11,
         });
         expect(describeSyntaxError(new Error(message), "")).toMatchObject({
            line: 1,
            column: 11,
         });
      });

      it("does not invent a position for a message without a code frame", () => {
         expect(describeSyntaxError(new Error("boom"), "const a = 1;")).toStrictEqual({
            reason: "boom",
         });
      });
   });

   it("falls back to the header position when there is no caret", () => {
      const message = "  x Unexpected token\n   ,-[7:3]\n";
      expect(describeSyntaxError(new Error(message))).toStrictEqual({
         reason: "Unexpected token",
         line: 7,
         column: 3,
      });
   });

   it("returns only the reason when the position is unknown", () => {
      expect(describeSyntaxError("boom")).toStrictEqual({ reason: "boom" });
      expect(describeSyntaxError(new Error("\n"))).toStrictEqual({
         reason: "Syntax error",
      });
   });
});
