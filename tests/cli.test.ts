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

import { afterEach, describe, expect, it, vi } from "vitest";

const ipcAutomation = vi.hoisted(() => vi.fn());
vi.mock("@src/automation.js", () => ({ ipcAutomation }));

describe("cli", () => {
   const originalArgv = process.argv;

   afterEach(() => {
      process.argv = originalArgv;
      vi.restoreAllMocks();
   });

   it("prints the package version for --version", async () => {
      process.argv = ["node", "ipcgen", "--version"];
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process, "exit").mockImplementation((() => {
         throw new Error("exit");
      }) as never);
      await expect(import("@src/cli.js")).rejects.toThrowError("exit");
      const manifest = await import("../package.json");
      expect(out).toHaveBeenCalledWith(`${manifest.default.version}\n`);
      expect(ipcAutomation).not.toHaveBeenCalled();
   });
});
