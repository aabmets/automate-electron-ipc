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
import { check, generate } from "@src/api.js";
import { withConfigProject } from "@testutils/config/config-project.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCHEMA = `import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   getValue: invoke<(id: number) => Promise<string>>(),
});
`;
const MANIFEST = { name: "project", config: { autoipc: { ipcDataDir: "ipc" } } };

describe("check", () => {
   const project = withConfigProject();
   let spies: ReturnType<typeof vi.spyOn>[] = [];

   beforeEach(() => {
      spies = [
         vi.spyOn(console, "warn").mockImplementation(() => undefined),
         vi.spyOn(console, "error").mockImplementation(() => undefined),
      ];
   });
   afterEach(() => {
      vi.restoreAllMocks();
   });

   const printed = () => spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));

   it("finds nothing stale after a generate", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });

      expect(await check({ cwd: project.dir })).toEqual({ stale: [] });
   });

   it("lists the files that are missing, sorted, and writes nothing", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);

      const { stale } = await check({ cwd: project.dir });

      expect(stale).toEqual(
         ["main.ts", "preload.ts", "window.d.ts"].map((n) => `${project.root}/ipc/${n}`),
      );
      expect(await project.list("ipc")).toEqual(["schema.ts"]);
   });

   it("lists the files that differ from the schema", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });
      await fsp.writeFile(`${project.dir}/ipc/schema.ts`, SCHEMA.replace("getValue", "getName"));
      await fsp.appendFile(`${project.dir}/ipc/window.d.ts`, "// edited\n");

      const { stale } = await check({ cwd: project.dir });

      expect(stale).toEqual(
         ["main.ts", "preload.ts", "window.d.ts"].map((n) => `${project.root}/ipc/${n}`),
      );
   });

   it("does not list a file that is fresh", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });
      await fsp.appendFile(`${project.dir}/ipc/window.d.ts`, "// edited\n");

      expect((await check({ cwd: project.dir })).stale).toEqual([
         `${project.root}/ipc/window.d.ts`,
      ]);
   });

   it("throws for a missing schema, and creates no directory", async () => {
      await project.write({}, MANIFEST);

      await expect(check({ cwd: project.dir })).rejects.toThrowError(
         `schema path does not exist: ${project.root}/ipc/schema.ts`,
      );
      expect(await project.list()).toEqual(["package.json"]);
   });

   it("is silent by default, and prints the lines of --check with logger: true", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);

      await check({ cwd: project.dir });
      expect(printed()).toEqual([]);

      await check({ cwd: project.dir, logger: true });
      expect(printed().join("\n")).toContain("Generated files are out of date:");

      await generate({ cwd: project.dir });
      await check({ cwd: project.dir, logger: true });
      expect(printed().join("\n")).toContain("Generated files are up to date.");
   });
});
