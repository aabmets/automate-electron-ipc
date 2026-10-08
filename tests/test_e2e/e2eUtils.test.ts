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
import { runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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
