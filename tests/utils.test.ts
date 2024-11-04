/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import utils from "@utils";
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
      const mockStartFrom = url.pathToFileURL("/mock/directory/start.js").href;
      const expectedPath = path.resolve("/mock/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });

   it("should find an existing file in the parent directory when not found in the starting directory", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock/directory/subdir/start.js").href;
      const expectedPath = path.resolve("/mock/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });

   it("should return an empty string when the file does not exist in any directory upwards", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock/directory/start.js").href;

      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe("");
   });
});

describe("concatRegex", () => {
   it("should concatenate multiple regex patterns into a single pattern", () => {
      const pattern = utils.concatRegex([
         /^/, // Start of string
         /[a-zA-Z]+/, // One or more letters
         /\s+/, // Whitespace
         /[0-9]+/, // One or more digits
         /\s+/, // Whitespace
         /[a-zA-Z]+/, // One or more letters
         /$/, // End of string
      ]);
      expect(pattern.source).toEqual("^[a-zA-Z]+\\s+[0-9]+\\s+[a-zA-Z]+$");
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

describe("extractFileHeader", () => {
   it("should return empty file header object when file is empty", () => {
      const result = utils.extractFileHeader("");
      expect(result).toMatchObject({
         shebang: null,
         license: null,
      });
   });

   it("should capture shebang from file contents", () => {
      const contents = "#!/usr/bin/node";
      const result = utils.extractFileHeader(contents);
      expect(result).toMatchObject({
         shebang: contents,
         license: null,
      });
   });

   it("should capture license header from file contents", () => {
      const license = `
         /*
          *   MIT License
          *
          *   Copyright (c) 2024, Mattias Aabmets
          *
          *   The contents of this file are subject to the terms and conditions defined in the License.
          *   You may not use, modify, or distribute this file except in compliance with the License.
          *
          *   SPDX-License-Identifier: MIT
          */
      `;
      const contents = utils.dedent(license).trim();
      const result = utils.extractFileHeader(contents);
      expect(result).toMatchObject({
         shebang: null,
         license: contents,
      });
   });
});

describe("digestObject", () => {
   it("should return the SHA256 checksum of an object", () => {
      const result = utils.digestObject({});
      const expected = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
      expect(result).toStrictEqual(expected);
   });
});

describe("getChannelName", () => {
   it("should remove extensions from file names", () => {
      const cn = utils.getChannelName({}, "handlers.ts", "getNodeVersion");
      expect(cn).toStrictEqual("44136fa3.handlers.getNodeVersion");
   });

   it("should handle nested directory structures", () => {
      const cn = utils.getChannelName({}, `general${path.sep}handlers.ts`, "getNodeVersion");
      expect(cn).toStrictEqual("44136fa3.general.handlers.getNodeVersion");
   });
});
