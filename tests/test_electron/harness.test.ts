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

// Tests of the harness of the Electron suite: when it skips, when it fails, and that it stops the
// process and removes its files on every outcome, including a scenario which hangs.

import { type ChildProcess, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
   detectElectron,
   electronGate,
   isGroupAlive,
   runElectronGroup,
} from "@testutils/electron-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const supported = detectElectron().ok;

afterEach(() => {
   vi.restoreAllMocks();
});

const exists = (target: string) =>
   fsp.stat(target).then(
      () => true,
      () => false,
   );

describe("detectElectron", () => {
   const binary = process.execPath;

   it("finds the binary and a display", () => {
      const support = detectElectron({
         platform: "linux",
         env: { DISPLAY: ":0" },
         resolveBinary: () => binary,
      });
      expect(support).toStrictEqual({ ok: true, binary });
   });

   it("reports a binary which is not installed", () => {
      const missing = detectElectron({
         platform: "linux",
         env: { DISPLAY: ":0" },
         resolveBinary: () => {
            throw new Error("Electron failed to install correctly");
         },
      });
      expect(missing.ok).toBe(false);
      expect(missing).toMatchObject({ reason: expect.stringContaining("not installed") });
      expect(missing).toMatchObject({ reason: expect.stringContaining("install.js") });
   });

   it("reports a binary which points to a file that is not there", () => {
      const missing = detectElectron({
         platform: "linux",
         env: { DISPLAY: ":0" },
         resolveBinary: () => path.join(root, "no-such-electron"),
      });
      expect(missing).toMatchObject({ ok: false, reason: expect.stringContaining("no file") });
   });

   it("needs xvfb-run on Linux without a display", () => {
      const probe = { platform: "linux", env: {}, resolveBinary: () => binary } as const;
      const without = detectElectron({ ...probe, hasExecutable: () => false });
      expect(without).toMatchObject({ ok: false, reason: expect.stringContaining("xvfb-run") });
      expect(detectElectron({ ...probe, hasExecutable: (file) => file === "xvfb-run" }).ok).toBe(
         true,
      );
   });

   it("needs no display on other platforms", () => {
      const support = detectElectron({
         platform: "darwin",
         env: {},
         resolveBinary: () => binary,
         hasExecutable: () => false,
      });
      expect(support.ok).toBe(true);
   });
});

describe("electronGate", () => {
   const missing = { ok: false, reason: "no binary" } as const;

   it("runs the tests when Electron is available", () => {
      expect(electronGate({ ok: true, binary: "electron" }, { REQUIRE_ELECTRON: "1" })).toBe("run");
   });

   it("skips the tests when Electron is not available", () => {
      expect(electronGate(missing, {})).toBe("skip");
      expect(electronGate(missing, { REQUIRE_ELECTRON: "0" })).toBe("skip");
   });

   it("fails the tests when Electron is not available and REQUIRE_ELECTRON=1", () => {
      expect(electronGate(missing, { REQUIRE_ELECTRON: "1" })).toBe("fail");
   });
});

/** Runs a test file of the suite in a new vitest, as a machine without Electron would. */
function runWithoutElectron(requireElectron: boolean) {
   const env: NodeJS.ProcessEnv = { ...process.env };
   for (const name of Object.keys(env)) {
      if (name.startsWith("VITEST")) {
         delete env[name];
      }
   }
   // Electron looks for its binary here, and does not find it.
   env.ELECTRON_OVERRIDE_DIST_PATH = path.join(root, "no-such-dist");
   env.REQUIRE_ELECTRON = requireElectron ? "1" : "";
   const outputDir = mkdtempSync(path.join(tmpdir(), "vitest-nested-"));
   const outputFile = path.join(outputDir, "report.json");
   try {
      const result = spawnSync(
         process.execPath,
         [
            path.join(root, "node_modules/vitest/vitest.mjs"),
            "run",
            "tests/test_electron/prefix.test.ts",
            "--coverage.enabled=false",
            "--reporter=json",
            `--outputFile=${outputFile}`,
         ],
         { cwd: root, env, encoding: "utf8" },
      );
      return { status: result.status, report: JSON.parse(readFileSync(outputFile, "utf8")) };
   } finally {
      rmSync(outputDir, { recursive: true, force: true });
   }
}

describe("a machine without Electron", () => {
   it("skips the Electron tests, and the run passes", () => {
      const { status, report } = runWithoutElectron(false);
      expect(status).toBe(0);
      expect(report.numFailedTests).toBe(0);
      expect(report.numPassedTests).toBe(0);
      expect(report.numPendingTests).toBeGreaterThan(0);
   }, 60_000);

   it("fails the Electron tests with REQUIRE_ELECTRON=1", () => {
      const { status, report } = runWithoutElectron(true);
      expect(status).not.toBe(0);
      expect(report.numFailedTests).toBe(1);
      const message = report.testResults[0].assertionResults[0].failureMessages.join("\n");
      expect(message).toContain("REQUIRE_ELECTRON=1");
      expect(message).toContain("not installed");
   }, 60_000);
});

describe.skipIf(!supported)("runElectronGroup", () => {
   /** The temp dirs which `runElectronGroup` makes: one for the fixture, one for the app. */
   function trackTempDirs() {
      const dirs: string[] = [];
      const mkdtemp = fsp.mkdtemp.bind(fsp);
      vi.spyOn(fsp, "mkdtemp").mockImplementation(async (...args: Parameters<typeof mkdtemp>) => {
         const dir = await mkdtemp(...args);
         dirs.push(String(dir));
         return dir;
      });
      return dirs;
   }

   it("returns what the scenarios returned, and the failure of one that failed", async () => {
      const dirs = trackTempDirs();
      const run = await runElectronGroup({
         fixture: "electron-core",
         scenarios: {
            fine: async (ctx) => {
               const win = await ctx.open();
               return await ctx.evaluate(win, () => (window as any).__env);
            },
            throws: () => {
               throw new Error("this scenario failed");
            },
            rejects: async () => {
               throw new Error("this scenario rejected");
            },
            laterOne: () => "still runs",
         },
         data: {},
      });
      expect(run.results.fine).toStrictEqual({
         ok: true,
         value: { sandboxed: true, contextIsolated: true },
      });
      expect(run.results.throws).toMatchObject({ ok: false });
      expect(run.results.throws).toMatchObject({
         error: expect.stringContaining("this scenario failed"),
      });
      expect(run.results.rejects).toMatchObject({
         error: expect.stringContaining("this scenario rejected"),
      });
      expect(run.results.laterOne).toStrictEqual({ ok: true, value: "still runs" });
      expect(run.generated["main.ts"]).toContain("export const ipc");
      expect(dirs).toHaveLength(2);
      for (const dir of dirs) {
         expect(await exists(dir)).toBe(false);
      }
   }, 60_000);

   it("fails a scenario which does not finish in time, and runs the others", async () => {
      const run = await runElectronGroup({
         fixture: "electron-core",
         scenarioTimeoutMs: 300,
         scenarios: {
            hangs: () => new Promise(() => undefined),
            after: () => "ran after the one which hangs",
         },
      });
      expect(run.results.hangs).toMatchObject({
         ok: false,
         error: expect.stringContaining("did not finish within 300 ms"),
      });
      expect(run.results.after).toStrictEqual({
         ok: true,
         value: "ran after the one which hangs",
      });
   }, 60_000);

   it("reports an error which nobody caught in the main process", async () => {
      const run = await runElectronGroup({
         fixture: "electron-core",
         scenarios: {
            uncaught: async (ctx) => {
               setTimeout(() => {
                  throw new Error("thrown in a timer");
               }, 10);
               await ctx.sleep(100);
            },
         },
      });
      expect(run.results.uncaught.ok).toBe(true);
      expect(run.uncaught).toHaveLength(1);
      expect(run.uncaught[0]).toContain("thrown in a timer");
   }, 60_000);

   it("reports a preload script which fails, which the main process would not see otherwise", async () => {
      const run = await runElectronGroup({
         fixture: "electron-core",
         scenarios: {
            missingPreload: async (ctx) => {
               const win = ctx.blank({ webPreferences: { preload: "/no/such/preload.js" } });
               await win.loadURL("app://main/index.html");
               await ctx.sleep(200);
            },
         },
      });
      expect(run.results.missingPreload.ok).toBe(true);
      expect(run.uncaught).toHaveLength(1);
      expect(run.uncaught[0]).toContain("preload-error in /no/such/preload.js");
   }, 60_000);

   it("kills a process which hangs, and leaves no process and no temp dir behind", async () => {
      const dirs = trackTempDirs();
      let child: ChildProcess | undefined;
      let appDir = "";
      await expect(
         runElectronGroup({
            fixture: "electron-core",
            // A loop that never ends blocks the main process, so that no timer can help.
            scenarios: {
               spins: () => {
                  for (;;) {}
               },
            },
            timeoutMs: 4000,
            onSpawn: (info) => {
               child = info.child;
               appDir = info.appDir;
            },
         }),
      ).rejects.toThrow("did not finish in time and was killed");
      expect(child).toBeDefined();
      expect(isGroupAlive(child as ChildProcess)).toBe(false);
      expect(await exists(appDir)).toBe(false);
      expect(dirs).toHaveLength(2);
      for (const dir of dirs) {
         expect(await exists(dir)).toBe(false);
      }
   }, 60_000);

   it("cleans up when the generator fails, before any process starts", async () => {
      const dirs = trackTempDirs();
      await expect(
         runElectronGroup({ fixture: "duplicate-channels", scenarios: { never: () => 1 } }),
      ).rejects.toThrow();
      expect(dirs).toHaveLength(1);
      expect(await exists(dirs[0])).toBe(false);
   }, 60_000);
});
