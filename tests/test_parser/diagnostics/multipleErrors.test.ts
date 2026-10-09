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
import path from "node:path";
import { planRun } from "@src/automation.js";
import { SchemaError, SchemaSyntaxError } from "@src/parser/diagnostics.js";
import { parseSpecs } from "@src/parser/parser.js";
import { SchemaErrors, toSchemaFailure } from "@src/parser/schema-errors.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import { describe, expect, it } from "vitest";

const IMPORT = 'import { defineChannels, invoke } from "automate-electron-ipc";';

/** A schema whose channels are the given entries, one per line. */
function schema(...entries: string[]): string {
   return [
      IMPORT,
      "export default defineChannels({",
      ...entries.map((e) => `   ${e},`),
      "});",
   ].join("\n");
}

function thrownBy(contents: string, name = "schema.ts"): unknown {
   try {
      parseSpecs({ contents, relativePath: name, fullPath: name });
   } catch (error) {
      return error;
   }
   throw new Error("Expected the parser to throw");
}

describe("several schema errors", () => {
   const automation = withAutomationDir("vitest-multiple-errors-");

   it("reports two bad channels of one file, in order", () => {
      const error = thrownBy(
         schema("first: invoke<() => void>({ one: 1 })", "second: invoke<() => void>({ two: 1 })"),
      );

      expect(error).toBeInstanceOf(SchemaErrors);
      const { errors, message } = error as SchemaErrors;
      expect(errors.map((e) => e.position)).toEqual([
         { line: 3, column: 32 },
         { line: 4, column: 33 },
      ]);
      expect(message).toBe(
         [
            "Schema file 'schema.ts' (3:32): channel 'first': option 'one' is not supported by 'invoke'.",
            "",
            "2 | export default defineChannels({",
            "3 |    first: invoke<() => void>({ one: 1 }),",
            "  |                                ^~~",
            "4 |    second: invoke<() => void>({ two: 1 }),",
            "",
            "Schema file 'schema.ts' (4:33): channel 'second': option 'two' is not supported by 'invoke'.",
            "",
            "3 |    first: invoke<() => void>({ one: 1 }),",
            "4 |    second: invoke<() => void>({ two: 1 }),",
            "  |                                 ^~~",
            "5 | });",
            "",
            "2 errors",
         ].join("\n"),
      );
   });

   it("keeps the channels that are valid out of the report", () => {
      const error = thrownBy(
         schema("good: invoke<() => void>()", "bad: invoke<() => void>({ nope: 1 })"),
      );

      expect(error).toBeInstanceOf(SchemaError);
      expect(error).not.toBeInstanceOf(SchemaErrors);
   });

   it("throws one error as the plain SchemaError, with an unchanged message", () => {
      const error = thrownBy(schema("bad: invoke<() => void>({ nope: 1 })")) as SchemaError;

      expect(error.constructor).toBe(SchemaError);
      expect(error.message).toBe(
         [
            "Schema file 'schema.ts' (3:30): channel 'bad': option 'nope' is not supported by 'invoke'.",
            "",
            "2 | export default defineChannels({",
            "3 |    bad: invoke<() => void>({ nope: 1 }),",
            "  |                              ^~~~",
            "4 | });",
         ].join("\n"),
      );
   });

   it("stops a file at an error that makes it unreadable", () => {
      const error = thrownBy(
         `${IMPORT}\nexport default defineChannels({ a: invoke(), ...x });\nexport const y = defineChannels({});`,
      );

      expect(error).toBeInstanceOf(SchemaError);
      expect(error).not.toBeInstanceOf(SchemaErrors);
      expect((error as Error).message).toContain(
         "only one defineChannels call is allowed per file.",
      );
   });

   it("keeps 20 errors, and counts the rest", () => {
      const entries = Array.from(
         { length: 25 },
         (_, i) => `c${String(i).padStart(2, "0")}: invoke<() => void>({ o${i}: 1 })`,
      );

      const error = thrownBy(schema(...entries)) as SchemaErrors;

      expect(error).toBeInstanceOf(SchemaErrors);
      expect(error.errors).toHaveLength(20);
      expect(error.omitted).toBe(5);
      expect(error.errors[19].message).toContain("channel 'c19'");
      expect(error.message).not.toContain("channel 'c20'");
      expect(error.message.endsWith("\n\nand 5 more errors\n\n25 errors")).toBe(true);
   });

   it("says 'error' when one error is left out", () => {
      const entries = Array.from({ length: 21 }, (_, i) => `c${i}: invoke<() => void>({ o: 1 })`);

      const error = thrownBy(schema(...entries)) as SchemaErrors;

      expect(error.omitted).toBe(1);
      expect(error.message.endsWith("\n\nand 1 more error\n\n21 errors")).toBe(true);
   });

   it("sorts the errors by file, then line, then column", () => {
      const at = (file: string, line: number, column: number) => {
         const error = new SchemaError(file, `${file} ${line}:${column}`);
         error.position = { line, column };
         return error;
      };

      const error = new SchemaErrors([
         at("b.ts", 1, 1),
         at("a.ts", 5, 2),
         at("a.ts", 5, 1),
         at("a.ts", 2, 9),
      ]);

      expect(error.errors.map((e) => e.message)).toEqual([
         "Schema file 'a.ts': a.ts 2:9",
         "Schema file 'a.ts': a.ts 5:1",
         "Schema file 'a.ts': a.ts 5:2",
         "Schema file 'b.ts': b.ts 1:1",
      ]);
   });

   it("sorts an error without a position before the positioned errors of its file", () => {
      const positioned = new SchemaError("a.ts", "positioned");
      positioned.position = { line: 1, column: 1 };
      const bare = new SchemaError("a.ts", "bare");

      const error = new SchemaErrors([positioned, bare]);

      expect(error.errors).toEqual([bare, positioned]);
   });

   it("has no count in the message of a report of one error", () => {
      const only = new SchemaError("a.ts", "only");

      expect(new SchemaErrors([only]).message).toBe("Schema file 'a.ts': only");
   });

   it("adds up the omitted errors of the files of a run", () => {
      const files = ["a.ts", "b.ts"].map(
         (file) =>
            new SchemaErrors(
               Array.from({ length: 20 }, (_, i) => {
                  const e = new SchemaError(file, `error ${i}`);
                  e.position = { line: i + 1, column: 1 };
                  return e;
               }),
               3,
            ),
      );

      const error = toSchemaFailure(files) as SchemaErrors;

      expect(error.errors).toHaveLength(20);
      expect(error.omitted).toBe(26);
      expect(error.message.endsWith("\n\nand 26 more errors\n\n46 errors")).toBe(true);
   });

   it("reports the errors of two files together, before the global validation", async () => {
      const dir = path.join(automation.dir, "schema");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, "a.ts"), schema("one: invoke<() => void>({ x: 1 })"));
      await fsp.writeFile(path.join(dir, "b.ts"), schema("one: invoke<() => void>({ y: 1 })"));
      automation.mockConfig({ ipcSchema: { path: dir, stats: await fsp.stat(dir) } } as never);

      const error = await planRun().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SchemaErrors);
      expect((error as SchemaErrors).errors.map((e) => path.basename(e.file))).toEqual([
         "a.ts",
         "b.ts",
      ]);
      expect((error as Error).message).toContain("option 'x' is not supported");
      expect((error as Error).message).toContain("option 'y' is not supported");
      expect((error as Error).message.endsWith("\n\n2 errors")).toBe(true);
   });

   it("reports a syntax error of one file with a bad channel of another", async () => {
      const dir = path.join(automation.dir, "schema");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, "a.ts"), "export default defineChannels({ a: ;\n});");
      await fsp.writeFile(path.join(dir, "b.ts"), schema("bad: invoke<() => void>({ nope: 1 })"));
      automation.mockConfig({ ipcSchema: { path: dir, stats: await fsp.stat(dir) } } as never);

      const error = await planRun().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SchemaErrors);
      const { errors, message } = error as SchemaErrors;
      expect(errors[0]).toBeInstanceOf(SchemaSyntaxError);
      expect(errors[1]).not.toBeInstanceOf(SchemaSyntaxError);
      expect(message).toBe(
         [
            `Syntax error in schema file '${path.join(dir, "a.ts")}:1:36': ${errors[0].message.split(": ").slice(1).join(": ")}`,
            "",
            `Schema file '${path.join(dir, "b.ts")}' (3:30): channel 'bad': ` +
               "option 'nope' is not supported by 'invoke'.",
            "",
            "2 | export default defineChannels({",
            "3 |    bad: invoke<() => void>({ nope: 1 }),",
            "  |                              ^~~~",
            "4 | });",
            "",
            "2 errors",
         ].join("\n"),
      );
   });

   it("throws the single error of a run as it is", async () => {
      const dir = path.join(automation.dir, "schema");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, "a.ts"), schema("good: invoke<() => void>()"));
      await fsp.writeFile(path.join(dir, "b.ts"), schema("bad: invoke<() => void>({ nope: 1 })"));
      automation.mockConfig({ ipcSchema: { path: dir, stats: await fsp.stat(dir) } } as never);

      const error = await planRun().catch((e: unknown) => e);

      expect((error as Error).constructor).toBe(SchemaError);
      expect((error as Error).message).toContain(`Schema file '${path.join(dir, "b.ts")}' (3:30)`);
   });
});
