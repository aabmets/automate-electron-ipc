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

// Tests of the harness of the Electron suite: that it stops the process and removes its files on
// every outcome, including a scenario which hangs.

import type { ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import { isGroupAlive } from "@testutils/electron/electron-process.js";
import { detectElectron } from "@testutils/electron/electron-support.js";
import { runElectronGroup } from "@testutils/electron/electron-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const supported = detectElectron().ok;

afterEach(() => {
   vi.restoreAllMocks();
});

const exists = (target: string) =>
   fsp.stat(target).then(
      () => true,
      () => false,
   );

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
