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
const findStaleOutputs = vi.hoisted(() => vi.fn());
vi.mock("@src/check.js", () => ({ findStaleOutputs }));
const getResolvedConfig = vi.hoisted(() => vi.fn());
vi.mock("@src/config.js", () => ({ default: { getResolvedConfig } }));

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
      findStaleOutputs.mockReset();
      getResolvedConfig.mockReset();
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
      expect(ipcAutomation).toHaveBeenCalledWith({ cwd: undefined, configFile: undefined });
      expect(process.exitCode).toBeUndefined();
   });

   it("passes --cwd and --config to the automation", async () => {
      process.argv = ["node", "ipcgen", "--cwd", "packages/app", "--config", "conf/ipc.config.ts"];
      ipcAutomation.mockResolvedValue(undefined);
      await importFreshCli();
      expect(ipcAutomation).toHaveBeenCalledOnce();
      expect(ipcAutomation).toHaveBeenCalledWith({
         cwd: "packages/app",
         configFile: "conf/ipc.config.ts",
      });
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

   describe("--check", () => {
      const config = { projectRoot: "/project", ipcSchema: { path: "/project/ipc/schema.ts" } };

      it("exits non-zero and lists the files when they are stale", async () => {
         process.argv = ["node", "ipcgen", "--check", "--cwd", "app", "--config", "c.json"];
         findStaleOutputs.mockResolvedValue(["/project/ipc/main.ts"]);
         getResolvedConfig.mockResolvedValue(config);
         const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
         await importFreshCli();
         expect(findStaleOutputs).toHaveBeenCalledWith({ cwd: "app", configFile: "c.json" });
         expect(String(err.mock.calls[0][0])).toContain("ipc/main.ts");
         expect(process.exitCode).toBe(1);
         expect(ipcAutomation).not.toHaveBeenCalled();
      });

      it("leaves the exit code alone when the files are fresh", async () => {
         process.argv = ["node", "ipcgen", "--check"];
         findStaleOutputs.mockResolvedValue([]);
         getResolvedConfig.mockResolvedValue(config);
         const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
         await importFreshCli();
         expect(String(warn.mock.calls[0][0])).toContain("up to date");
         expect(process.exitCode).toBeUndefined();
         expect(ipcAutomation).not.toHaveBeenCalled();
      });

      it("prints the schema-not-found message and exits non-zero without a schema", async () => {
         process.argv = ["node", "ipcgen", "--check"];
         findStaleOutputs.mockResolvedValue(null);
         getResolvedConfig.mockResolvedValue(config);
         const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
         await importFreshCli();
         expect(String(warn.mock.calls[0][0])).toContain("/project/ipc/schema.ts");
         expect(process.exitCode).toBe(1);
         expect(ipcAutomation).not.toHaveBeenCalled();
      });

      it("prints the error and exits non-zero when the check fails", async () => {
         process.argv = ["node", "ipcgen", "--check"];
         findStaleOutputs.mockRejectedValue(new Error("Syntax error in schema file"));
         const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
         await importFreshCli();
         expect(String(err.mock.calls[0][0])).toContain("Syntax error in schema file");
         expect(process.exitCode).toBe(1);
      });
   });
});
