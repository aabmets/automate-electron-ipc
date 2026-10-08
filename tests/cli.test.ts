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

/** Imports the cli with a fresh commander program, since it registers on a global singleton. */
async function importFreshCli(): Promise<void> {
   vi.resetModules();
   vi.doMock("commander", async (importOriginal) => {
      const mod = await importOriginal<typeof import("commander")>();
      return { ...mod, program: new mod.Command() };
   });
   await import("@src/cli.js");
}

describe("cli", () => {
   const originalArgv = process.argv;

   afterEach(() => {
      process.argv = originalArgv;
      process.exitCode = undefined;
      ipcAutomation.mockReset();
      vi.restoreAllMocks();
      vi.doUnmock("commander");
   });

   it("prints the package version for --version", async () => {
      process.argv = ["node", "ipcgen", "--version"];
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process, "exit").mockImplementation((() => {
         throw new Error("exit");
      }) as never);
      await expect(importFreshCli()).rejects.toThrowError("exit");
      const manifest = await import("../package.json");
      expect(out).toHaveBeenCalledWith(`${manifest.default.version}\n`);
      expect(ipcAutomation).not.toHaveBeenCalled();
   });

   it("runs the automation when called without arguments", async () => {
      process.argv = ["node", "ipcgen"];
      ipcAutomation.mockResolvedValue(undefined);
      await importFreshCli();
      expect(ipcAutomation).toHaveBeenCalledOnce();
      expect(process.exitCode).toBeUndefined();
   });

   it("prints the error and exits non-zero when the automation fails", async () => {
      // Regression for T08: failures surfaced as an unhandled rejection stack trace.
      process.argv = ["node", "ipcgen"];
      ipcAutomation.mockRejectedValue(new Error("Syntax error in schema file 'a.ts:1:2': oops"));
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await importFreshCli();
      expect(String(err.mock.calls[0][0])).toContain("Syntax error in schema file 'a.ts:1:2'");
      expect(process.exitCode).toBe(1);
   });
});
