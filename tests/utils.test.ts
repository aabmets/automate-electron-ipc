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
import path from "node:path";
import url from "node:url";
import utils from "@src/utils.js";
import { describe, expect, it, vi } from "vitest";

describe("searchUpwards", () => {
   it("should find an existing file in the default base path", () => {
      const mockForPath = "testfile.txt";
      const expectedPath = path.resolve(process.cwd(), mockForPath);

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
   it("should fall back to node_modules when no .git directory is found", () => {
      const nodeModules = path.resolve(import.meta.dirname, "../node_modules");
      const spy = vi.spyOn(fs, "existsSync").mockImplementation((p) => p === nodeModules);
      try {
         const result = utils.resolveUserProjectPath("sub/dir");
         expect(result).toBe(path.resolve(nodeModules, "../sub/dir").replaceAll("\\", "/"));
      } finally {
         spy.mockRestore();
      }
   });
});

describe("isSchemaSourceFile", () => {
   it("accepts .ts, .mts and .cts files", () => {
      expect(utils.isSchemaSourceFile("schema.ts")).toBe(true);
      expect(utils.isSchemaSourceFile("nested/user.mts")).toBe(true);
      expect(utils.isSchemaSourceFile("nested/user.cts")).toBe(true);
      expect(utils.isSchemaSourceFile("d.ts")).toBe(true);
   });

   it("rejects declaration files", () => {
      expect(utils.isSchemaSourceFile("types.d.ts")).toBe(false);
      expect(utils.isSchemaSourceFile("nested/types.d.mts")).toBe(false);
      expect(utils.isSchemaSourceFile("types.d.cts")).toBe(false);
   });

   it("rejects other file types", () => {
      for (const name of ["README.md", "data.json", "user.js", "user.tsx", "user.ts.bak", "ts"]) {
         expect(utils.isSchemaSourceFile(name)).toBe(false);
      }
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

describe("capitalize", () => {
   it("should uppercase only the first character", () => {
      expect(utils.capitalize("getUser")).toBe("GetUser");
      expect(utils.capitalize("a")).toBe("A");
      expect(utils.capitalize("Already")).toBe("Already");
      expect(utils.capitalize("")).toBe("");
   });
});
