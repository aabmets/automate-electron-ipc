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
import { describe, expect, it } from "vitest";

const BOM = "﻿";

function firstAlias(code: string) {
   const { module, src } = parser.parseModule(code);
   const alias = module.body.find((item) => item.type === "TsTypeAliasDeclaration") as any;
   return { alias, src };
}

describe("parseModule, non-ASCII source", () => {
   // Regression for T66: swc spans are UTF-8 byte offsets, the slices used UTF-16 indices.
   it("slices the text of a node after a non-ASCII comment", () => {
      const { alias, src } = firstAlias(
         "// Käyttäjä 日本\nconst a = 1;\ntype T = (a: string) => void;",
      );
      expect(src.text(alias)).toBe("type T = (a: string) => void;");
   });

   it("slices the text of an astral character, which is two UTF-16 code units", () => {
      const { alias, src } = firstAlias("const s = '😀';\ntype T = () => void;");
      expect(src.text(alias)).toBe("type T = () => void;");
   });

   it("slices a string literal type, a type name and a comment inside the type parameters", () => {
      const { alias, src } = firstAlias(
         'type T = /* é */ <X extends "ü"> (a: "é", b: Üser) => Promise<Üser>;',
      );
      const sig = parser.parseSignature(alias.typeAnnotation, src);
      expect(sig.definition).toBe('<X extends "ü"> (a: "é", b: Üser) => Promise<Üser>');
      expect(sig.params.map((param) => [param.name, param.type])).toStrictEqual([
         ["a", '"é"'],
         ["b", "Üser"],
      ]);
      expect(sig.returnType).toBe("Promise<Üser>");
      expect(sig.customTypes).toStrictEqual(["Üser"]);
      expect(sig.definition.slice(sig.paramsStart)).toBe('a: "é", b: Üser) => Promise<Üser>');
   });

   it("finds the parameter list after non-ASCII comments inside the type parameters", () => {
      const { alias, src } = firstAlias(
         'type T = <X extends "ü" /* 日本 ( */ = "ü"> /* é ( */ (a: X) => void;',
      );
      const sig = parser.parseSignature(alias.typeAnnotation, src);
      expect(sig.definition.slice(sig.paramsStart)).toBe("a: X) => void");
   });

   it("slices correctly when the file starts with a BOM", () => {
      const { alias, src } = firstAlias(`${BOM}type T = (a: "é") => void;`);
      expect(src.text(alias)).toBe('type T = (a: "é") => void;');
   });

   it("slices correctly with a BOM and a non-ASCII comment", () => {
      const { alias, src } = firstAlias(`${BOM}// é\ntype T = (a: "é") => void;`);
      expect(src.text(alias)).toBe('type T = (a: "é") => void;');
   });
});
