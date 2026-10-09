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
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

describe("ipcAutomation, schema with a syntax error", () => {
   // Regression for T08: the parse error was swallowed and reported as "no channels found".
   it("rejects with the file path, line and column", async () => {
      await expect(runFixture("syntax-error")).rejects.toThrowError(
         /Syntax error in schema file '.*schema\.ts:4:\d+': /,
      );
   });
});

describe("ipcAutomation, config values that would break the output", () => {
   /** Runs the fixture, and returns the message of the error that the run failed with. */
   async function failureOf(fixture: string): Promise<string> {
      try {
         project = await runFixture(fixture);
      } catch (error) {
         return error instanceof Error ? error.message : String(error);
      }
      throw new Error("the run did not fail");
   }

   it("refuses an output path that is the schema file, and leaves the schema alone", async () => {
      const fixture = path.join(import.meta.dirname, "../fixtures/output-over-schema");
      const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-e2e-"));
      try {
         await fsp.cp(fixture, root, { recursive: true });
         const before = await fsp.readFile(path.join(root, "ipc/schema.ts"), "utf8");
         const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
         try {
            await expect(ipcAutomation(root)).rejects.toThrowError(
               /'utilityBindingsPath' \('ipc\/schema\.ts'\) is the schema file/,
            );
         } finally {
            warn.mockRestore();
         }
         expect(await fsp.readFile(path.join(root, "ipc/schema.ts"), "utf8")).toBe(before);
         // The run stops before it writes any file.
         expect(await fsp.readdir(path.join(root, "ipc"))).toStrictEqual(["schema.ts"]);
      } finally {
         await fsp.rm(root, { recursive: true, force: true });
      }
   });

   it("refuses output paths that are declaration files", async () => {
      expect(await failureOf("declaration-output-paths")).toMatch(
         /utilityBindingsPath must be the path of a \.ts file/,
      );
   });

   it("refuses an allowed origin with the default port, which no origin can match", async () => {
      const failure = await failureOf("default-port-origins");
      expect(failure).toContain("'http://localhost:80' has the default port of its scheme");
      expect(failure).toContain("Write 'http://localhost'");
   });
});

describe("ipcAutomation, diagnostics that name a path", () => {
   it("names the schema file, and not its directory, in an error about one of its channels", async () => {
      // Regression for T92: the single schema file was reported as its directory, 'ipc'.
      const failure = await runFixture("schema-file-reserved-name").then(
         (fixture) => {
            project = fixture;
            return "the run did not fail";
         },
         (error: Error) => error.message,
      );

      expect(failure).toContain("Schema file 'ipc/schema.ts'");
      expect(failure).not.toContain("Schema file 'ipc'");
   });

   it("names the package.json which is not valid JSON", async () => {
      // Regression for T92: the error was the bare message of `JSON.parse`.
      const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-e2e-"));
      try {
         await fsp.writeFile(path.join(root, "package.json"), '{ "name": "broken", }');
         const failure = await ipcAutomation(root).then(
            () => "the run did not fail",
            (error: Error) => error.message,
         );
         expect(failure).toContain(`Cannot parse '${root.replaceAll("\\", "/")}/package.json'`);
      } finally {
         await fsp.rm(root, { recursive: true, force: true });
      }
   });
});
