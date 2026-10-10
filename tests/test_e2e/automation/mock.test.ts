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
import { describe, expect, it, vi } from "vitest";

describe("mock generation, fixture mock", () => {
   it("type-checks the mock and a consumer that uses it with typed arguments", async () => {
      const project = await fixtures.run("mock");

      expect(await project.typecheck()).toBe("");
   }, 60_000);

   // The checks of the consumer must be able to fail: the `@ts-expect-error` lines are errors if
   // the mock accepts what it should refuse.
   it("reports a call whose argument has the wrong type", async () => {
      const project = await fixtures.run("mock");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "schema-wrong.ts"),
         [
            'import { createIpcMock } from "./mock";',
            "const mock = createIpcMock();",
            'mock.getUser.invoke("1");',
         ].join("\n"),
      );

      const diagnostics = await project.typecheck();

      expect(diagnostics).toContain("schema-wrong.ts");
      expect(diagnostics).not.toContain("schema-usage.ts");
   }, 60_000);

   it("writes no mock without the config", async () => {
      const project = await fixtures.run("mock", { config: { mock: undefined } });

      await expect(
         fsp.access(path.join(project.dir, project.ipcDataDir, "mock.ts")),
      ).rejects.toThrow();
   });

   it("fakes the surface of no scope only, and writes no mock for a scope", async () => {
      const project = await fixtures.run("electron-scopes", { config: { mock: true } });

      const mock = await project.read("mock.ts");

      expect(mock).toContain("getVersion: { invoke:");
      expect(mock).toContain("note: { send:");
      for (const scoped of ["getSettings", "vault", "openFile", "exportRows", "audit"]) {
         expect(mock).not.toContain(scoped);
      }
      expect((await fsp.readdir(path.join(project.dir, project.ipcDataDir))).sort()).not.toEqual(
         expect.arrayContaining(["mock.settings.ts"]),
      );
      expect(await project.typecheck()).toBe("");
   }, 60_000);

   it("writes a mock with no members for a schema without channels of the page", async () => {
      const project = await fixtures.run("mock");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "schema.ts"),
         [
            'import { callUtility, defineChannels } from "automate-electron-ipc";',
            "export default defineChannels({ tick: callUtility<() => void>() });",
         ].join("\n"),
      );

      await fsp.rm(path.join(project.dir, project.ipcDataDir, "schema-usage.ts"));

      await ipcAutomation(project.dir);

      expect(await project.read("mock.ts")).toContain("export interface IpcMock {");
      expect(await project.typecheck()).toBe("");
   }, 60_000);

   describe("when the config is turned off", () => {
      it("lists the generated mock as stale, and removes it", async () => {
         vi.spyOn(console, "warn").mockImplementation(() => undefined);
         const project = await fixtures.run("mock");
         const manifest = path.join(project.dir, "package.json");
         await fsp.writeFile(
            manifest,
            JSON.stringify({ name: "fixture-mock", config: { autoipc: { ipcDataDir: "ipc" } } }),
         );
         const mock = toPosix(path.join(project.dir, project.ipcDataDir, "mock.ts"));

         expect(await findStaleOutputs({ cwd: project.dir })).toContain(mock);
         await ipcAutomation(project.dir);

         await expect(fsp.access(mock)).rejects.toThrow();
         expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);
         vi.restoreAllMocks();
      });

      it("keeps a mock.ts that was written by hand", async () => {
         vi.spyOn(console, "warn").mockImplementation(() => undefined);
         const project = await fixtures.run("mock", { config: { mock: false } });
         const mock = path.join(project.dir, project.ipcDataDir, "mock.ts");
         await fsp.writeFile(mock, "export const mine = 1;\n");

         await ipcAutomation(project.dir);

         expect(await fsp.readFile(mock, "utf8")).toBe("export const mine = 1;\n");
         expect(await findStaleOutputs({ cwd: project.dir })).toEqual([]);
         vi.restoreAllMocks();
      });
   });
});
