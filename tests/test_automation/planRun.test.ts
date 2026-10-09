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
import { ipcAutomation, planRun } from "@src/automation.js";
import { notice } from "@src/output-files.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixturesDir = path.resolve(import.meta.dirname, "../fixtures");

function exists(file: string): Promise<boolean> {
   return fsp.access(file).then(
      () => true,
      () => false,
   );
}

describe("planRun", () => {
   let dir = "";

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-plan-run-"));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   // The fixtures cover the main, preload and typings files, the scopes, utility processes and
   // service workers, which are the outputs that a run lists conditionally.
   it.each([
      ["electron-core", ["main.ts", "preload.ts", "window.d.ts"]],
      ["electron-scopes", ["main.ts", "preload.ts", "window.d.ts", "window.settings.d.ts"]],
      ["electron-utility", ["utility.ts"]],
      ["electron-service-worker", ["service-worker-preload.ts", "service-worker.d.ts"]],
   ])(
      "plans the files of '%s' that ipcAutomation writes, and writes nothing",
      async (fixture, names) => {
         await fsp.cp(path.join(fixturesDir, fixture), dir, { recursive: true });
         const before = await fsp.readdir(path.join(dir, "ipc"));

         const plan = await planRun({ cwd: dir });

         if (plan === null) {
            throw new Error("expected a plan");
         }
         const { outputs } = plan;
         const planned = outputs.map((output) => path.posix.basename(output.path));
         expect(planned).toEqual(expect.arrayContaining(names));
         expect(new Set(planned).size).toBe(planned.length);
         for (const output of outputs) {
            expect(path.isAbsolute(output.path)).toBe(true);
            expect(output.path).not.toContain("\\");
            expect(output.contents.startsWith(`${notice(plan.config)}\n\n`)).toBe(true);
         }
         expect(await fsp.readdir(path.join(dir, "ipc"))).toEqual(before);

         await ipcAutomation(dir);

         const written = await Promise.all(outputs.map((o) => fsp.readFile(o.path, "utf8")));
         expect(written).toEqual(outputs.map((output) => output.contents));
         const created = (await fsp.readdir(path.join(dir, "ipc"))).filter(
            (n) => !before.includes(n),
         );
         expect(created.sort()).toEqual(planned.sort());
      },
   );

   it("returns null for a missing schema, and makes no directory", async () => {
      await fsp.writeFile(
         path.join(dir, "package.json"),
         JSON.stringify({ config: { autoipc: { ipcDataDir: "ipc" } } }),
      );

      expect(await planRun({ cwd: dir })).toBeNull();
      expect(await exists(path.join(dir, "ipc"))).toBe(false);
   });

   it("is what ipcAutomation writes whether it gets a cwd or the options of a run", async () => {
      await fsp.cp(path.join(fixturesDir, "electron-core"), dir, { recursive: true });
      const plan = await planRun({ cwd: dir });
      const output = plan?.outputs[0];

      await ipcAutomation({ cwd: dir });

      expect(await fsp.readFile(output?.path ?? "", "utf8")).toBe(output?.contents);
   });
});
