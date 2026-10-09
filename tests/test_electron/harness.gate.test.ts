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

// Tests of the harness of the Electron suite: when it skips and when it fails, on a machine with and
// without Electron.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectElectron, electronGate } from "@testutils/electron/electron-support.js";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

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
            "tests/test_electron/options/prefix.test.ts",
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
