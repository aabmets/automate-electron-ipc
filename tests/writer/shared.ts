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
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BaseWriter } from "@src/writer/base-writer.js";
import { MockInstance, afterAll, afterEach, beforeEach, vitest } from "vitest";

export class MockedBaseWriter extends BaseWriter {
   public getTargetFilePath(): string {
      return "";
   }
}

export function mockGetTargetFilePath() {
   let spy: MockInstance;
   const dirName = `vitest-${crypto.randomBytes(8).toString("hex")}`;

   beforeEach(() => {
      spy = vitest.spyOn(MockedBaseWriter.prototype, "getTargetFilePath");
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

export default { MockedBaseWriter, mockGetTargetFilePath };
