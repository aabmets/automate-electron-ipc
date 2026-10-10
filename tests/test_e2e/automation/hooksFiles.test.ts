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
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import { findStaleOutputs } from "@src/check.js";
import { toPosix } from "@src/utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("the hooks option and the generated files", () => {
   afterEach(() => {
      vi.restoreAllMocks();
   });

   /** Silences the logger and records its warnings. A fixture run restores `console.warn`, so this follows it. */
   const recordWarnings = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

   /** Runs the react-hooks fixture, then runs it again with the `hooks` option replaced. */
   async function rerunWith(hooks: unknown) {
      const project = await fixtures.run("react-hooks");
      const manifestFile = path.join(project.dir, "package.json");
      const manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
      manifest.config.autoipc.hooks = hooks;
      await fsp.writeFile(manifestFile, JSON.stringify(manifest));
      const dir = path.join(project.dir, project.ipcDataDir);
      const listed = () => fsp.readdir(dir).then((names) => names.sort());
      return { project, dir, listed };
   }

   it("writes no hooks file unless the option asks for one", async () => {
      const project = await fixtures.run("electron-core");

      expect(await fsp.readdir(path.join(project.dir, project.ipcDataDir))).not.toEqual(
         expect.arrayContaining([expect.stringMatching(/^hooks\./)]),
      );
   });

   it("removes hooks.react.ts when the option is turned off", async () => {
      const { project, listed } = await rerunWith(false);
      expect(await listed()).toContain("hooks.react.ts");

      await ipcAutomation(project.dir);

      expect(await listed()).not.toContain("hooks.react.ts");
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);
   });

   it("lets --check list hooks.react.ts as stale while the option is off and the file is there", async () => {
      const { project, dir } = await rerunWith(false);

      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([
         toPosix(path.join(dir, "hooks.react.ts")),
      ]);
   });

   it("leaves a hooks.react.ts that was not generated alone", async () => {
      const { project, dir, listed } = await rerunWith(false);
      await fsp.writeFile(path.join(dir, "hooks.react.ts"), "export const mine = 1;\n");

      await ipcAutomation(project.dir);

      expect(await listed()).toContain("hooks.react.ts");
      expect(await fsp.readFile(path.join(dir, "hooks.react.ts"), "utf8")).toBe(
         "export const mine = 1;\n",
      );
   });

   it("writes hooks.vue.ts for vue, and removes the file of react", async () => {
      const { project, listed } = await rerunWith("vue");
      expect(await listed()).toContain("hooks.react.ts");

      await ipcAutomation(project.dir);

      const names = await listed();
      expect(names).not.toContain("hooks.react.ts");
      expect(names).toContain("hooks.vue.ts");
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);
   });

   it("removes hooks.vue.ts when the option goes back to react, or off", async () => {
      const project = await fixtures.run("vue-hooks");
      const dir = path.join(project.dir, project.ipcDataDir);
      const listed = () => fsp.readdir(dir).then((names) => names.sort());
      const manifestFile = path.join(project.dir, "package.json");
      const setHooks = async (hooks: unknown) => {
         const manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
         manifest.config.autoipc.hooks = hooks;
         await fsp.writeFile(manifestFile, JSON.stringify(manifest));
      };
      expect(await listed()).toContain("hooks.vue.ts");

      await setHooks("react");
      await ipcAutomation(project.dir);
      expect(await listed()).toContain("hooks.react.ts");
      expect(await listed()).not.toContain("hooks.vue.ts");

      await setHooks("vue");
      await ipcAutomation(project.dir);
      await setHooks(false);
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([
         toPosix(path.join(dir, "hooks.vue.ts")),
      ]);
      await ipcAutomation(project.dir);
      expect(await listed()).not.toContain("hooks.vue.ts");
      expect(await listed()).not.toContain("hooks.react.ts");
   });

   it("warns about nothing for either framework", async () => {
      const react = await fixtures.run("react-hooks");
      const vue = await fixtures.run("vue-hooks");
      const warn = recordWarnings();

      await ipcAutomation(react.dir);
      await ipcAutomation(vue.dir);

      const warnings = warn.mock.calls.map((call) => String(call[0]));
      expect(warnings.filter((text) => !text.includes("Successfully generated"))).toEqual([]);
   });

   it("lets --check call a project up to date after a run, and stale when the hooks file is gone", async () => {
      const project = await fixtures.run("react-hooks");
      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);

      const file = path.join(project.dir, project.ipcDataDir, "hooks.react.ts");
      await fsp.rm(file);

      expect(await findStaleOutputs({ cwd: project.dir })).toEqual([toPosix(file)]);
   });
});
