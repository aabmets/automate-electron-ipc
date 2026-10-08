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
import { NODE_NEXT_OPTIONS, runFixture } from "@testutils/e2e-utils.js";
import { runTsc } from "@testutils/tsc-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

/** Runs `runFixture` and returns the temp dirs that it created. */
async function runAndTrackTempDirs(fixture: string): Promise<{ dirs: string[]; error: unknown }> {
   const dirs: string[] = [];
   const mkdtemp = fsp.mkdtemp.bind(fsp);
   vi.spyOn(fsp, "mkdtemp").mockImplementation(async (...args: Parameters<typeof mkdtemp>) => {
      const dir = await mkdtemp(...args);
      dirs.push(String(dir));
      return dir;
   });
   let error: unknown;
   try {
      await runFixture(fixture);
   } catch (err) {
      error = err;
   }
   return { dirs, error };
}

const exists = (dir: string) =>
   fsp.stat(dir).then(
      () => true,
      () => false,
   );

describe("runFixture", () => {
   it("deletes the temp dir when the generator throws", async () => {
      const { dirs, error } = await runAndTrackTempDirs("duplicate-channels");
      expect(error).toBeInstanceOf(Error);
      expect(dirs).toHaveLength(1);
      expect(await exists(dirs[0])).toBe(false);
   });

   it("deletes the temp dir when the schema has a syntax error", async () => {
      const { dirs, error } = await runAndTrackTempDirs("syntax-error");
      expect(error).toBeInstanceOf(Error);
      expect(dirs).toHaveLength(1);
      expect(await exists(dirs[0])).toBe(false);
   });

   it("deletes the temp dir when the fixture does not exist", async () => {
      const { dirs, error } = await runAndTrackTempDirs("no-such-fixture");
      expect(error).toBeInstanceOf(Error);
      expect(dirs).toHaveLength(1);
      expect(await exists(dirs[0])).toBe(false);
   });

   it("keeps the temp dir of a successful run until cleanup", async () => {
      const dirs: string[] = [];
      const mkdtemp = fsp.mkdtemp.bind(fsp);
      vi.spyOn(fsp, "mkdtemp").mockImplementation(async (...args: Parameters<typeof mkdtemp>) => {
         const dir = await mkdtemp(...args);
         dirs.push(String(dir));
         return dir;
      });
      const project = await runFixture("single-file");
      expect(await exists(project.root)).toBe(true);
      await project.cleanup();
      expect(await exists(dirs[0])).toBe(false);
   });
});

describe("runTsc", () => {
   let dir: string;
   const fakeTsc = async (script: string): Promise<string> => {
      const file = path.join(dir, "fake-tsc");
      await fsp.writeFile(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      return file;
   };

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-runtsc-"));
   });
   afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
   });

   // Regression for T70: the exit status was ignored, so a crashed tsc gave "" (no errors).
   it("throws when tsc is killed by a signal", async () => {
      const tsc = await fakeTsc("kill -KILL $$");
      expect(() => runTsc(dir, tsc)).toThrowError("tsc was killed by signal SIGKILL");
   });

   it("throws when tsc cannot be started", () => {
      expect(() => runTsc(dir, path.join(dir, "missing"))).toThrowError(/tsc could not run: /);
   });

   it("throws when tsc exits abnormally, with its output in the message", async () => {
      const tsc = await fakeTsc("echo 'out of memory' >&2; exit 134");
      expect(() => runTsc(dir, tsc)).toThrowError("tsc exited with status 134: out of memory");
   });

   it("throws when tsc reports failure without a diagnostic", async () => {
      const tsc = await fakeTsc("exit 2");
      expect(() => runTsc(dir, tsc)).toThrowError("tsc exited with status 2 and printed no diag");
   });

   it("returns the diagnostics of a failing run, and an empty string for a clean one", async () => {
      const failing = await fakeTsc("echo 'a.ts(1,1): error TS1000: Bad'; exit 2");
      expect(runTsc(dir, failing)).toBe("a.ts(1,1): error TS1000: Bad");
      const clean = await fakeTsc("exit 0");
      expect(runTsc(dir, clean)).toBe("");
   });

   it("type-checks the generated files with NodeNext resolution", async () => {
      const project = await runFixture("dotted-imports");
      try {
         expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
      } finally {
         await project.cleanup();
      }
   });

   it("reports an extensionless import of a generated file under NodeNext", async () => {
      // The `bundler` resolution accepts imports that Node rejects, so NodeNext must fail them.
      const project = await runFixture("single-file");
      try {
         const file = path.join(project.dir, project.ipcDataDir, "main.ts");
         const text = await fsp.readFile(file, "utf8");
         await fsp.writeFile(file, `${text}\nimport type { Nope } from "./schema";\n`);
         const esm = { ...NODE_NEXT_OPTIONS, noEmit: true };
         await fsp.writeFile(path.join(project.dir, "package.json"), '{"type":"module"}');
         expect(await project.typecheck(esm)).toContain("TS2835");
      } finally {
         await project.cleanup();
      }
   });
});
