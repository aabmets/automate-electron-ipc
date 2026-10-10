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

import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcAutomation = vi.hoisted(() => vi.fn());
vi.mock("@src/automation.js", () => ({ ipcAutomation }));
const findStaleOutputs = vi.hoisted(() => vi.fn());
vi.mock("@src/check.js", () => ({ findStaleOutputs }));
const getResolvedConfig = vi.hoisted(() => vi.fn());
vi.mock("@src/config.js", () => ({ default: { getResolvedConfig } }));
const watchSchema = vi.hoisted(() => vi.fn());
vi.mock("@src/watch.js", () => ({ watchSchema }));

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
      // Bun ignores `undefined` here and keeps the old code, so reset to 0 and compare with `?? 0`.
      process.exitCode = 0;
      ipcAutomation.mockReset();
      findStaleOutputs.mockReset();
      getResolvedConfig.mockReset();
      watchSchema.mockReset();
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
      expect(process.exitCode ?? 0).toBe(0);
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

   describe("the --out-* flags", () => {
      let dir: string;

      beforeEach(async () => {
         // The project root is `dir`, and `dir/packages/app` is a directory inside of it.
         dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-cli-"));
         await fsp.mkdir(path.join(dir, "packages/app"), { recursive: true });
         await fsp.writeFile(path.join(dir, "package.json"), "{}");
      });
      afterEach(() => fsp.rm(dir, { recursive: true, force: true }));

      const run = async (...args: string[]) => {
         process.argv = ["node", "ipcgen", ...args];
         ipcAutomation.mockResolvedValue(undefined);
         await importFreshCli();
         return ipcAutomation.mock.calls.map(([options]) => options);
      };

      it.each([
         ["--out-main", "mainBindingsPath"],
         ["--out-preload", "preloadBindingsPath"],
         ["--out-types", "rendererTypesPath"],
      ])("%s sets %s, as a path from the project root", async (flag, option) => {
         const [options] = await run("--cwd", dir, flag, "src/generated/out.ts");
         expect(options).toStrictEqual({
            cwd: dir,
            configFile: undefined,
            overrides: { [option]: "src/generated/out.ts" },
         });
      });

      it("takes the paths of the flags from the working directory, not from the project root", async () => {
         const cwd = path.join(dir, "packages/app");
         const [options] = await run(
            "--cwd",
            cwd,
            "--out-main",
            "gen/main.ts",
            "--out-preload",
            "../shared/preload.ts",
            "--out-types",
            path.join(dir, "types/window.d.ts"),
         );
         expect(options.overrides).toStrictEqual({
            mainBindingsPath: "packages/app/gen/main.ts",
            preloadBindingsPath: "packages/shared/preload.ts",
            rendererTypesPath: "types/window.d.ts",
         });
      });

      it("takes the paths from the process working directory without --cwd", async () => {
         const cwd = vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "packages/app"));
         const [options] = await run("--out-types", "types/window.d.ts");
         expect(options.overrides).toStrictEqual({
            rendererTypesPath: "packages/app/types/window.d.ts",
         });
         cwd.mockRestore();
      });

      it("sets no overrides when no flag gives a path", async () => {
         const calls = await run("--cwd", dir);
         expect(calls).toHaveLength(1);
         expect(calls[0]).toStrictEqual({ cwd: dir, configFile: undefined });
      });

      it("fails when the working directory is in no project", async () => {
         const outside = await fsp.mkdtemp(path.join(tmpdir(), "vitest-cli-none-"));
         try {
            process.argv = ["node", "ipcgen", "--cwd", outside, "--out-main", "a.ts"];
            const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
            await importFreshCli();
            expect(ipcAutomation).not.toHaveBeenCalled();
            expect(String(err.mock.calls[0][0])).toContain("Cannot find the project root");
            expect(process.exitCode).toBe(1);
         } finally {
            await fsp.rm(outside, { recursive: true, force: true });
         }
      });
   });

   it("prints the error and exits non-zero when the automation fails", async () => {
      // Failures used to surface as an unhandled rejection stack trace.
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
         expect(process.exitCode ?? 0).toBe(0);
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

   describe("--watch", () => {
      it("starts the watcher with --cwd and --config, instead of a single run", async () => {
         process.argv = [
            "node",
            "ipcgen",
            "--watch",
            "--cwd",
            "app",
            "--config",
            "ipc.config.json",
         ];
         vi.spyOn(process, "once").mockImplementation(() => process);
         await importFreshCli();
         expect(watchSchema).toHaveBeenCalledOnce();
         expect(watchSchema).toHaveBeenCalledWith({ cwd: "app", configFile: "ipc.config.json" });
         expect(ipcAutomation).not.toHaveBeenCalled();
      });

      it("refuses --watch together with --check", async () => {
         process.argv = ["node", "ipcgen", "--watch", "--check"];
         const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
         vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("exit");
         }) as never);
         await expect(importFreshCli()).rejects.toThrowError("exit");
         expect(String(err.mock.calls[0][0])).toContain("cannot be used with option");
         expect(watchSchema).not.toHaveBeenCalled();
         expect(findStaleOutputs).not.toHaveBeenCalled();
      });

      it.each(["SIGINT", "SIGTERM"])("closes the watchers and exits 0 on %s", async (signal) => {
         process.argv = ["node", "ipcgen", "--watch"];
         const stop = vi.fn();
         watchSchema.mockReturnValue(stop);
         const handlers = new Map<string, () => void>();
         vi.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
            handlers.set(event, handler);
            return process;
         }) as never);
         const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
         await importFreshCli();
         expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
         expect(stop).not.toHaveBeenCalled();

         handlers.get(signal)?.();

         expect(stop).toHaveBeenCalledOnce();
         expect(exit).toHaveBeenCalledWith(0);
      });
   });
});
