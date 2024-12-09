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

import crypto from "node:crypto";
import { Stats } from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import utils from "@src/utils.js";
import { BaseWriter } from "@src/writer/base-writer.js";
import { MockInstance, afterAll, afterEach, beforeEach, vi } from "vitest";

export function mockFspReadFile(data: any): void {
   const spy = vi.spyOn(fsp, "readFile");
   spy.mockImplementation(() => {
      return new Promise((resolve, _) => {
         resolve(JSON.stringify(data));
      });
   });
}

export function mockFspStats(isDirectory: boolean): void {
   const spy = vi.spyOn(fsp, "stat");
   spy.mockImplementation(() => {
      return new Promise((resolve, _) => {
         resolve({
            isDirectory: () => isDirectory,
            isFile: () => !isDirectory,
         } as Stats);
      });
   });
}

export function mockResolveUserProjectPath(): void {
   const spy = vi.spyOn(utils, "resolveUserProjectPath");
   spy.mockImplementation((subPath = "") => path.join("/home/user/project", subPath));
}

export function mockGetTargetFilePath<T extends new (...args: any[]) => BaseWriter>(cls: T) {
   let spy: MockInstance;
   const dirName = `vitest-${crypto.randomBytes(8).toString("hex")}`;

   beforeEach(() => {
      spy = vi.spyOn(cls.prototype, "getTargetFilePath");
      const fileName = `testfile-${crypto.randomBytes(8).toString("hex")}`;
      spy.mockImplementation(() => {
         return path.join(tmpdir(), dirName, fileName);
      });
   });
   afterEach(() => spy.mockRestore());
   afterAll(async () => {
      const dirPath = path.join(tmpdir(), dirName);
      await fsp.rm(dirPath, { recursive: true, force: true });
   });
}

export default {
   mockFspReadFile,
   mockFspStats,
   mockResolveUserProjectPath,
   mockGetTargetFilePath,
};
