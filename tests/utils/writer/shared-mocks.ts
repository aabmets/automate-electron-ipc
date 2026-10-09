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
import { afterAll, afterEach, beforeEach, MockInstance, vi } from "vitest";

export function mockFspReadFile(data: any): void {
   const spy = vi.spyOn(fsp, "readFile");
   spy.mockImplementation(() => {
      return Promise.resolve(JSON.stringify(data));
   });
}

/**
 * Mocks `fsp.stat` so that it answers per path: the given paths exist as a directory or a file
 * (matched with `/` separators), every other path rejects like a missing one.
 */
export function mockFspStatsByPath(entries: Record<string, "directory" | "file">): void {
   const spy = vi.spyOn(fsp, "stat");
   spy.mockImplementation(((target: string) => {
      const kind = entries[String(target).replaceAll("\\", "/")];
      if (!kind) {
         return Promise.reject(Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" }));
      }
      return Promise.resolve({
         isDirectory: () => kind === "directory",
         isFile: () => kind === "file",
      } as Stats);
   }) as unknown as typeof fsp.stat);
}

export function mockResolveUserProjectPath(): void {
   const spy = vi.spyOn(utils, "resolveUserProjectPath");
   spy.mockImplementation((subPath = "") => path.join("/home/user/project", subPath));
}

export function mockGetTargetFilePath(cls: { prototype: unknown }) {
   let spy: MockInstance;
   const dirName = `vitest-${crypto.randomBytes(8).toString("hex")}`;

   beforeEach(() => {
      spy = vi.spyOn(cls.prototype as object, "getTargetFilePath" as never);
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
