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

import fs from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";
import utils from "@src/utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

describe("searchUpwards", () => {
   it("should find an existing file in the default base path", () => {
      const mockForPath = "testfile.txt";
      // The default start is the directory of the file under test, whatever the working directory.
      const sourceDir = path.dirname(
         url.fileURLToPath(new URL("../../src/utils.ts", import.meta.url)),
      );
      const expectedPath = path.join(sourceDir, mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath);
      expect(result).toBe(expectedPath);
   });

   it("should find an existing file in the specified starting directory", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock1/directory/start.js").href;
      const expectedPath = path.resolve("/mock1/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });

   it("should find an existing file in the parent directory when not found in the starting directory", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock2/directory/subdir/start.js").href;
      const expectedPath = path.resolve("/mock2/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });

   it("should return an empty string when the file does not exist in any directory upwards", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock3/directory/start.js").href;

      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe("");
   });
});

describe("searchUpwards with a filesystem path", () => {
   it("should accept a plain directory path as the starting point", () => {
      const startFrom = path.resolve("/mock5/directory/start.js");
      const expectedPath = path.resolve("/mock5/directory", "plain.txt");
      const spy = vi.spyOn(fs, "existsSync").mockImplementation((p) => p === expectedPath);
      try {
         expect(utils.searchUpwards("plain.txt", startFrom)).toBe(expectedPath);
      } finally {
         spy.mockRestore();
      }
   });
});

describe("resolveUserProjectPath", () => {
   let root: string;
   const app = () => path.join(root, "packages/app");

   beforeEach(async () => {
      // A workspace: the root and the app package both have a package.json.
      root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-utils-"));
      await fsp.mkdir(path.join(app(), "src/main"), { recursive: true });
      await fsp.writeFile(path.join(root, "package.json"), "{}");
      await fsp.writeFile(path.join(app(), "package.json"), "{}");
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(root, { recursive: true, force: true });
   });

   const posix = (value: string) => value.replaceAll("\\", "/");

   it("resolves to the nearest package.json above the working directory", () => {
      // Regression for T07: the root was found from the install location of the library,
      // by the first .git, which is the repo root of a workspace, not the app package.
      vi.spyOn(process, "cwd").mockReturnValue(path.join(app(), "src/main"));
      expect(utils.resolveUserProjectPath("ipc")).toBe(posix(path.join(app(), "ipc")));
      expect(utils.resolveUserProjectPath()).toBe(posix(app()));
   });

   it("resolves to the workspace root when run from outside a package", () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.join(root, "packages"));
      expect(utils.resolveUserProjectPath("package.json")).toBe(
         posix(path.join(root, "package.json")),
      );
   });

   it("prefers an explicit cwd over the working directory", () => {
      vi.spyOn(process, "cwd").mockReturnValue(root);
      expect(utils.resolveUserProjectPath("x", app())).toBe(posix(path.join(app(), "x")));
      expect(utils.resolveUserProjectPath("x", path.join(app(), "src"))).toBe(
         posix(path.join(app(), "x")),
      );
   });

   it("resolves a relative cwd against the working directory", () => {
      // A relative path from the real working directory, since the runtimes differ in whether
      // their `path.resolve` calls a mocked `process.cwd`.
      const relative = path.relative(process.cwd(), path.join(app(), "src"));
      expect(path.isAbsolute(relative)).toBe(false);
      expect(utils.resolveUserProjectPath("", relative)).toBe(posix(app()));
   });

   it("does not reuse a cached result when the cwd changes", () => {
      const cwd = vi.spyOn(process, "cwd");
      cwd.mockReturnValue(app());
      expect(utils.resolveUserProjectPath()).toBe(posix(app()));
      cwd.mockReturnValue(root);
      expect(utils.resolveUserProjectPath()).toBe(posix(root));
      cwd.mockReturnValue(app());
      expect(utils.resolveUserProjectPath()).toBe(posix(app()));
   });

   it("throws when no package.json exists above the cwd, and finds one created later", async () => {
      const bare = path.join(root, "bare");
      await fsp.mkdir(bare);
      await fsp.rm(path.join(root, "package.json"));
      const original = fs.existsSync;
      // Hide the package.json files of this machine above the temp dir.
      vi.spyOn(fs, "existsSync").mockImplementation((p) => {
         return String(p).startsWith(root) ? original(p) : false;
      });
      expect(() => utils.resolveUserProjectPath("", bare)).toThrowError(
         /no package\.json in '.*bare' or any parent directory/,
      );

      await fsp.writeFile(path.join(bare, "package.json"), "{}");
      expect(utils.resolveUserProjectPath("", bare)).toBe(posix(bare));
   });
});

describe("toPosix", () => {
   it("turns every backslash into a slash and leaves other paths as they are", () => {
      expect(utils.toPosix("ipc\\schema\\main.ts")).toBe("ipc/schema/main.ts");
      expect(utils.toPosix("C:\\app\\ipc/schema.ts")).toBe("C:/app/ipc/schema.ts");
      expect(utils.toPosix("ipc/schema.ts")).toBe("ipc/schema.ts");
      expect(utils.toPosix("")).toBe("");
   });
});

describe("comparePaths", () => {
   it("compares the slash spelling, so that the order is the same on every platform", () => {
      // Raw code units would put 'aA.ts' before 'a\b.ts', as 'A' (0x41) sorts before '\' (0x5C),
      // but after 'a/b.ts', as '/' (0x2F) sorts before 'A'.
      const sorted = ["aA.ts", "a\\b.ts", "a/c.ts"].sort(utils.comparePaths);
      expect(sorted).toStrictEqual(["a\\b.ts", "a/c.ts", "aA.ts"]);
   });

   it("returns zero for the two spellings of one path", () => {
      expect(utils.comparePaths("a\\b.ts", "a/b.ts")).toBe(0);
      expect(utils.comparePaths("a/a.ts", "a/b.ts")).toBeLessThan(0);
      expect(utils.comparePaths("a/b.ts", "a/a.ts")).toBeGreaterThan(0);
   });
});
