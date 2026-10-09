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
import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("fixture path-for-file, with `getPathForFile` on", () => {
   const load = async () => {
      const project = await fixtures.run("path-for-file");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
      return fake;
   };

   it("exposes the helper next to the channels", async () => {
      const { exposed } = await load();

      expect(Object.keys(exposed.ipc).sort()).toStrictEqual(["getPathForFile", "upload"]);
      expect(typeof exposed.ipc.getPathForFile).toBe("function");
   });

   it("returns the path that webUtils reports for the file", async () => {
      const { exposed, electron } = await load();
      const file = { name: "a.txt", path: "/home/user/a.txt" };

      expect(exposed.ipc.getPathForFile(file)).toBe("/home/user/a.txt");
      expect(electron.webUtils.getPathForFile).toHaveBeenCalledTimes(1);
      expect(electron.webUtils.getPathForFile.mock.calls[0][0]).toBe(file);
   });

   it("lets the error of webUtils through, as it does for a value that is not a file", async () => {
      const { exposed, electron } = await load();
      electron.webUtils.getPathForFile.mockImplementationOnce(() => {
         throw new TypeError("Expected a File");
      });

      expect(() => exposed.ipc.getPathForFile("nope")).toThrowError("Expected a File");
   });

   it("keeps the channels working", async () => {
      const { exposed, electron } = await load();
      electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, value: true });

      await expect(exposed.ipc.upload.invoke("/a", "a")).resolves.toBe(true);
   });

   it("generates files that type-check, with the helper used from the page", async () => {
      const project = await fixtures.run("path-for-file");

      expect(project.generated["window.d.ts"]).toContain("getPathForFile: (file: File) => string;");
      expect(await project.typecheck()).toBe("");
   });

   it("fails the type-check when the helper gets something that is not a File", async () => {
      const project = await fixtures.run("path-for-file");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace("getPathForFile(file)", "getPathForFile(file.name)"));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });
});

describe("fixture expose-as, with `getPathForFile` off", () => {
   it("exposes no helper, and declares none", async () => {
      const project = await fixtures.run("expose-as");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      expect(fake.exposed.bridge.getPathForFile).toBeUndefined();
      expect(project.generated["window.d.ts"]).not.toContain("getPathForFile");
      expect(project.generated["preload.ts"]).not.toContain("webUtils");
   });
});
