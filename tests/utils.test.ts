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
import { describe, expect, test, vi } from "vitest";
import utils from "../src/utils";

describe("utils", () => {
   test("searchUpwards for existing file from default base path", () => {
      const mockForPath = "testfile.txt";
      const expectedPath = path.resolve(process.cwd(), mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath);
      expect(result).toBe(expectedPath);
   });
   test("searchUpwards for existing file in current directory", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock/directory/start.js").href;
      const expectedPath = path.resolve("/mock/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });
   test("searchUpwards for existing file in parent directory", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock/directory/subdir/start.js").href;
      const expectedPath = path.resolve("/mock/directory", mockForPath);

      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => filePath === expectedPath);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe(expectedPath);
   });
   test("searchUpwards for non-existing file", () => {
      const mockForPath = "testfile.txt";
      const mockStartFrom = url.pathToFileURL("/mock/directory/start.js").href;

      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const result = utils.searchUpwards(mockForPath, mockStartFrom);
      expect(result).toBe("");
   });
   test("concatRegex", () => {
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
