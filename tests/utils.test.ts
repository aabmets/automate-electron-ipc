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
         url.fileURLToPath(new URL("../src/utils.ts", import.meta.url)),
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

describe("concatRegex", () => {
   it("should concatenate multiple regex patterns into a single pattern", () => {
      const pattern = utils.concatRegex([
         /^/, // Start of string
         /[a-zA-Z]+/, // One or more letters
         /\s+/, // Whitespace
         /\d+/, // One or more digits
         /\s+/, // Whitespace
         /[a-zA-Z]+/, // One or more letters
         /$/, // End of string
      ]);
      expect(pattern.source).toEqual("^[a-zA-Z]+\\s+\\d+\\s+[a-zA-Z]+$");
   });
});

describe("isCaseInsensitiveFileSystem", () => {
   afterEach(vi.restoreAllMocks);

   const stats = (ino: number, dev = 1) => ({ ino: BigInt(ino), dev: BigInt(dev) });

   /** Mocks `fsp.stat` so that only the given paths exist, each with its identity. */
   function mockStat(entries: Record<string, ReturnType<typeof stats>>) {
      return vi.spyOn(fsp, "stat").mockImplementation(((target: string) => {
         const found = entries[String(target).replaceAll("\\", "/")];
         return found === undefined
            ? Promise.reject(Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" }))
            : Promise.resolve(found);
      }) as never);
   }

   it("is true when the name with swapped case finds the same directory", async () => {
      mockStat({ "/proj/src/ipc": stats(7), "/proj/src/IPC": stats(7) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(true);
   });

   it("is false when the name with swapped case finds nothing", async () => {
      mockStat({ "/proj/src/ipc": stats(7) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
   });

   it("is false when the name with swapped case finds another directory", async () => {
      mockStat({ "/proj/src/ipc": stats(7), "/proj/src/IPC": stats(8) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
      vi.restoreAllMocks();
      mockStat({ "/proj/src/ipc": stats(7, 1), "/proj/src/IPC": stats(7, 2) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc")).resolves.toBe(false);
   });

   it("probes the nearest existing ancestor of a directory that does not exist", async () => {
      const spy = mockStat({ "/proj/src": stats(3), "/proj/SRC": stats(3) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/ipc/deeper")).resolves.toBe(true);
      expect(spy).toHaveBeenCalledWith("/proj/SRC", { bigint: true });
   });

   it("skips a name without letters", async () => {
      mockStat({ "/proj/src/1234": stats(9), "/proj/src": stats(3), "/proj/SRC": stats(3) });
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src/1234")).resolves.toBe(true);
   });

   it("is false when no directory of the path exists", async () => {
      mockStat({});
      await expect(utils.isCaseInsensitiveFileSystem("/proj/src")).resolves.toBe(false);
   });

   it("writes nothing", async () => {
      const root = await fsp.mkdtemp(path.join(tmpdir(), "vitest-utils-case-"));
      try {
         await fsp.mkdir(path.join(root, "ipc"));
         const before = await fsp.readdir(root);
         const result = await utils.isCaseInsensitiveFileSystem(path.join(root, "ipc"));
         expect(typeof result).toBe("boolean");
         expect(await fsp.readdir(root)).toStrictEqual(before);
         expect(await fsp.readdir(path.join(root, "ipc"))).toStrictEqual([]);
      } finally {
         await fsp.rm(root, { recursive: true, force: true });
      }
   });
});

describe("isPathInside", () => {
   it("should return true when childPath is directly inside parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user/documents/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });

   it("should return false when childPath is outside of parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/otherUser/documents/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should return false when childPath is the same as parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user";
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should handle relative paths correctly", () => {
      const parentPath = "/home/user";
      const childPath = path.join(parentPath, "../user2/documents/file.txt");
      expect(utils.isPathInside(childPath, parentPath)).toBe(false);
   });

   it("should return true for nested directories within the parentPath", () => {
      const parentPath = "/home/user";
      const childPath = "/home/user/documents/subdir/file.txt";
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });

   it("should work with different path separators (cross-platform)", () => {
      const parentPath = path.join("home", "user");
      const childPath = path.join("home", "user", "documents", "file.txt");
      expect(utils.isPathInside(childPath, parentPath)).toBe(true);
   });
});

describe("dedent", () => {
   it("should dedent code written in template strings", () => {
      const result = utils.dedent(`
         const obj = {
            nested: {
               data: "asdfg",
            },
            data: 123,
         }
      `);
      expect(result.trim()).toStrictEqual(
         [
            "const obj = {",
            "   nested: {",
            '      data: "asdfg",',
            "   },",
            "   data: 123,",
            "}",
         ].join("\n"),
      );
   });
});

describe("compareStrings", () => {
   it("returns zero for equal strings and a sign for different ones", () => {
      expect(utils.compareStrings("a", "a")).toBe(0);
      expect(utils.compareStrings("a", "b")).toBeLessThan(0);
      expect(utils.compareStrings("b", "a")).toBeGreaterThan(0);
   });

   it("compares by code units: upper case, underscore, lower case, then non-ASCII", () => {
      const sorted = ["ä", "b", "_", "B", "a", "A", "2", "10"].sort(utils.compareStrings);
      expect(sorted).toStrictEqual(["10", "2", "A", "B", "_", "a", "b", "ä"]);
   });

   it("does not use the locale of the process", () => {
      const spy = vi.spyOn(String.prototype, "localeCompare");
      try {
         ["ä", "z", "a"].sort(utils.compareStrings);
         expect(spy).not.toHaveBeenCalled();
      } finally {
         spy.mockRestore();
      }
   });
});

describe("isSchemaSourceFile", () => {
   it.each(["schema.ts", "a/b/schema.mts", "x.cts", "dir.v2/user.model.ts", "a.d.tsx.ts"])(
      "accepts %s",
      (name) => {
         expect(utils.isSchemaSourceFile(name)).toBe(true);
      },
   );

   it.each([
      "legacy.d.ts",
      "legacy.d.mts",
      "legacy.d.cts",
      "dir/types.d.ts",
      "README.md",
      "data.json",
      "script.js",
      "component.tsx",
      "ts",
      "schema.ts.bak",
   ])("rejects %s", (name) => {
      expect(utils.isSchemaSourceFile(name)).toBe(false);
   });
});
