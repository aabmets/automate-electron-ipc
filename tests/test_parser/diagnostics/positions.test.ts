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

import { parseSpecs } from "@src/parser/parser.js";
import { validateGlobalChannelSpecs } from "@src/validation/global-validation.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

const IMPORT = 'import { defineChannels, invoke } from "automate-electron-ipc";';
const BOM = "﻿";

function parse(contents: string, name = "schema.ts"): t.SpecsCollection {
   return parseSpecs({ contents, relativePath: name, fullPath: name });
}

function messageOf(contents: string, name = "schema.ts"): string {
   try {
      parse(contents, name);
   } catch (error) {
      return (error as Error).message;
   }
   throw new Error("Expected the parser to throw");
}

const lines = (...rows: string[]) => rows.join("\n");

describe("schema errors, position and code frame", () => {
   it("points at the callee of an unknown verb", () => {
      const message = messageOf(
         lines(
            IMPORT,
            "export default defineChannels({",
            "   getUser: fetch<() => void>(),",
            "});",
         ),
      );
      expect(message).toBe(
         lines(
            "Schema file 'schema.ts' (3:13): channel 'getUser': unknown verb 'fetch'. Use one of: " +
               "invoke, send, emit, ask, stream, port, mainPort, callUtility, notifyUtility, " +
               "callMain, notifyMain, invokeUtility, streamUtility, invokeFromWorker, " +
               "sendFromWorker, askWorker, emitToWorker.",
            "",
            "2 | export default defineChannels({",
            "3 |    getUser: fetch<() => void>(),",
            "  |             ^~~~~",
            "4 | });",
         ),
      );
   });

   it("points at the key of an unsupported option", () => {
      const message = messageOf(
         lines(
            IMPORT,
            "export default defineChannels({",
            "   a: invoke<() => void>({ nope: 1 }),",
            "});",
         ),
      );
      expect(message).toBe(
         lines(
            "Schema file 'schema.ts' (3:28): channel 'a': option 'nope' is not supported by 'invoke'.",
            "",
            "2 | export default defineChannels({",
            "3 |    a: invoke<() => void>({ nope: 1 }),",
            "  |                            ^~~~",
            "4 | });",
         ),
      );
   });

   it("points at a signature that is not a function type", () => {
      const message = messageOf(
         lines(IMPORT, "export default defineChannels({", "   a: invoke<string>(),", "});"),
      );
      expect(message).toBe(
         lines(
            "Schema file 'schema.ts' (3:14): channel 'a': the signature must be a function type, found 'string'.",
            "",
            "2 | export default defineChannels({",
            "3 |    a: invoke<string>(),",
            "  |              ^~~~~~",
            "4 | });",
         ),
      );
   });

   it("points at a validate reference that the file does not import", () => {
      const message = messageOf(
         lines(
            IMPORT,
            "export default defineChannels({",
            "   a: invoke<(id: string) => void>({ validate: schema }),",
            "});",
         ),
      );
      expect(message).toBe(
         lines(
            "Schema file 'schema.ts' (3:48): channel 'a': option 'validate' refers to 'schema', " +
               "which is not imported in the schema file. Import the schema from another module.",
            "",
            "2 | export default defineChannels({",
            "3 |    a: invoke<(id: string) => void>({ validate: schema }),",
            "  |                                                ^~~~~~",
            "4 | });",
         ),
      );
   });

   it("aligns the caret after a tab and a wide character", () => {
      const message = messageOf(
         lines(IMPORT, "export default defineChannels({", "\t日本: fetch<() => void>(),", "});"),
      );
      // The editor column counts the tab and each ideograph once. The frame expands the tab to
      // four columns and gives each ideograph two, so the caret is ten columns in.
      expect(message).toContain("Schema file 'schema.ts' (3:6): channel '日本': unknown verb");
      expect(message.split("\n\n")[1]).toBe(
         lines(
            "2 | export default defineChannels({",
            "3 |     日本: fetch<() => void>(),",
            "  |           ^~~~~",
            "4 | });",
         ),
      );
   });

   it("counts the column of a character outside the BMP as two code units", () => {
      const message = messageOf(
         lines(IMPORT, "export default defineChannels({ /* 😀 */ a: fetch() });"),
      );
      expect(message).toContain("Schema file 'schema.ts' (2:45): channel 'a': unknown verb");
      expect(message.split("\n\n")[1]).toBe(
         lines(
            '1 | import { defineChannels, invoke } from "automate-electron-ipc";',
            "2 | export default defineChannels({ /* 😀 */ a: fetch() });",
            "  |                                             ^~~~~",
         ),
      );
   });

   it("does not count a BOM in the column", () => {
      const source = `${IMPORT} export default defineChannels({ a: fetch() });`;
      const withBom = messageOf(BOM + source);
      expect(withBom).toBe(messageOf(source));
      expect(withBom).toContain("Schema file 'schema.ts' (1:100): channel 'a': unknown verb");
      expect(withBom.split("\n\n")[1]).not.toContain(BOM);
   });

   it("shows no line before an error on the first line", () => {
      const first = `${IMPORT} export default defineChannels({ a: fetch() });`;
      const message = messageOf(lines(first, "// the end"));
      expect(message.split("\n\n")[1]).toBe(
         lines(`1 | ${first}`, `  | ${" ".repeat(99)}^~~~~`, "2 | // the end"),
      );
   });

   it("keeps the line numbers aligned when the frame crosses a power of ten", () => {
      const message = messageOf(
         lines(
            ...Array.from({ length: 8 }, () => "//"),
            IMPORT,
            "export default defineChannels({ a: fetch() });",
         ),
      );
      expect(message.split("\n\n")[1]).toBe(
         lines(
            ' 9 | import { defineChannels, invoke } from "automate-electron-ipc";',
            "10 | export default defineChannels({ a: fetch() });",
            "   |                                    ^~~~~",
         ),
      );
   });

   it("points at the second defineChannels call", () => {
      const message = messageOf(
         lines(IMPORT, "const a = defineChannels({});", "export default defineChannels({});"),
      );
      expect(message).toContain("Schema file 'schema.ts' (3:16): only one defineChannels call");
   });
});

describe("schema errors, position of a channel", () => {
   it("records the position of the channel key on the spec", () => {
      const { channelSpecArray } = parse(
         lines(
            IMPORT,
            "export default defineChannels({",
            "   a: invoke<() => void>(),",
            "\tb: invoke<() => void>(),",
            "});",
         ),
      );
      expect(channelSpecArray.map((spec) => [spec.name, spec.loc])).toStrictEqual([
         ["a", { line: 3, column: 4 }],
         ["b", { line: 4, column: 2 }],
      ]);
   });

   it("names the position of a reserved channel name, without a code frame", () => {
      const contents = lines(
         IMPORT,
         "export default defineChannels({",
         "   constructor: invoke<() => void>(),",
         "});",
      );
      expect(messageOf(contents)).toBe(
         "Schema file 'schema.ts' (3:4): Channel name 'constructor' is reserved, since it is a " +
            "member of every object. Choose another name.",
      );
   });

   it("names the positions of a channel that two files declare", () => {
      const file = (name: string, body: string): t.ParsedFileSpecs => ({
         fullPath: `/p/${name}`,
         relativePath: name,
         specs: parse(lines(IMPORT, "export default defineChannels({", body, "});"), name),
      });
      const files = [
         file("b.ts", "\tgetUser: invoke<() => void>(),"),
         file("a.ts", "   getUser: invoke<() => void>(),"),
      ];
      expect(() => validateGlobalChannelSpecs(files)).toThrowError(
         new Error(
            "Channel name 'getUser' is declared in both 'a.ts' (3:4) and 'b.ts' (3:2). " +
               "Channel names must be unique across the application.",
         ),
      );
   });
});
