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
import logger from "@src/logger.js";
import { withConfigProject } from "@testutils/config/config-project.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCHEMA = `import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getValue: invoke<(id: number) => Promise<string>>(),
   note: send<(text: string) => void>(),
});
`;
const MANIFEST = { name: "project", config: { autoipc: { ipcDataDir: "ipc" } } };

function exists(file: string): Promise<boolean> {
   return fsp.access(file).then(
      () => true,
      () => false,
   );
}

describe("generate", () => {
   const project = withConfigProject();
   let spies: ReturnType<typeof vi.spyOn>[] = [];

   beforeEach(() => {
      spies = [
         vi.spyOn(console, "warn").mockImplementation(() => undefined),
         vi.spyOn(console, "error").mockImplementation(() => undefined),
         vi.spyOn(console, "log").mockImplementation(() => undefined),
      ];
   });
   afterEach(() => {
      vi.restoreAllMocks();
   });

   const printed = () => spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));

   it("writes the files, and returns their paths sorted, with the number of channels", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);

      const result = await generate({ cwd: project.dir });

      expect(result.channels).toBe(2);
      expect(result.files).toEqual(
         expect.arrayContaining(["main.ts", "preload.ts", "window.d.ts"].map(abs)),
      );
      expect(result.files).toEqual([...result.files].sort());
      expect(result.files.every((file) => file.startsWith(`${project.root}/ipc/`))).toBe(true);
      expect((await project.list("ipc")).filter((name) => name !== "schema.ts")).toEqual(
         result.files.map((file) => file.slice(project.root.length + "/ipc/".length)).sort(),
      );
   });

   function abs(name: string): string {
      return `${project.root}/ipc/${name}`;
   }

   it("counts the channels of every schema file", async () => {
      await project.write(
         {
            "ipc/schema/a.ts": SCHEMA,
            "ipc/schema/b.ts": SCHEMA.replace("getValue", "other").replace("note", "memo"),
         },
         MANIFEST,
      );
      expect((await generate({ cwd: project.dir })).channels).toBe(4);
   });

   it("writes the files that ipcgen would, which a check then finds fresh", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });
      expect(await check({ cwd: project.dir })).toEqual({ stale: [] });
   });

   it("throws the message of the missing schema warning, and creates nothing", async () => {
      await project.write({}, MANIFEST);

      await expect(generate({ cwd: project.dir })).rejects.toThrowError(
         `Skipping IPC automation, because schema path does not exist: ${project.root}/ipc/schema.ts`,
      );

      expect(await project.list()).toEqual(["package.json"]);
   });

   it("is silent by default, even for a schema with no channels, and does not set the exit code", async () => {
      await project.write({ "ipc/schema.ts": "export const x = 1;\n" }, MANIFEST);
      const exitCode = process.exitCode;

      expect((await generate({ cwd: project.dir })).channels).toBe(0);

      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });
      await fsp.rm(`${project.dir}/ipc/schema.ts`);
      await expect(generate({ cwd: project.dir })).rejects.toThrowError();
      expect(printed()).toEqual([]);
      expect(process.exitCode).toBe(exitCode);
   });

   it("prints the lines of the CLI with logger: true", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);

      await generate({ cwd: project.dir, logger: true });

      expect(printed().join("\n")).toContain("Successfully generated IPC bindings:");
      expect(printed().join("\n")).toContain("2 channels from path 'ipc/schema.ts'");
   });

   it("warns about a schema with no channels with logger: true", async () => {
      await project.write({ "ipc/schema.ts": "export const x = 1;\n" }, MANIFEST);

      await generate({ cwd: project.dir, logger: true });

      expect(printed().join("\n")).toContain("no channels were found in path:");
   });

   it("gives the logger back to the CLI, whether the run returns or throws", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);
      await generate({ cwd: project.dir });
      logger.nonExistentSchemaPath("/after-return");
      await fsp.rm(`${project.dir}/ipc/schema.ts`);
      await expect(generate({ cwd: project.dir, logger: true })).rejects.toThrow();
      await fsp.writeFile(`${project.dir}/ipc/schema.ts`, "export default defineChannels({ x: ");
      await expect(generate({ cwd: project.dir })).rejects.toThrow();
      logger.nonExistentSchemaPath("/after-throw");

      expect(printed().filter((line) => line.includes("/after-"))).toHaveLength(2);
   });

   it("throws the errors of the schema instead of printing them", async () => {
      await project.write({ "ipc/schema.ts": "export default defineChannels({ x: " }, MANIFEST);

      await expect(generate({ cwd: project.dir })).rejects.toThrowError(/schema/i);
      expect(printed()).toEqual([]);
   });

   it("hands the overrides to the config", async () => {
      await project.write({ "ipc/schema.ts": SCHEMA }, MANIFEST);

      const { files } = await generate({
         cwd: project.dir,
         overrides: { mainBindingsPath: "generated/main.ts" },
      });

      expect(files).toContain(`${project.root}/generated/main.ts`);
      expect(await exists(`${project.dir}/generated/main.ts`)).toBe(true);
      expect(await exists(`${project.dir}/ipc/main.ts`)).toBe(false);
   });

   it("reads the config file that configFile names", async () => {
      await project.write(
         { "ipc/schema.ts": SCHEMA, "custom.json": '{ "ipcDataDir": "ipc", "codeIndent": 2 }' },
         { name: "project" },
      );

      const { files } = await generate({ cwd: project.dir, configFile: "custom.json" });

      expect(files).toContain(`${project.root}/ipc/main.ts`);
      expect(await fsp.readFile(`${project.dir}/ipc/main.ts`, "utf8")).toMatch(/\n {2}\S/);
   });

   it("deletes the generated files of earlier runs that it no longer generates", async () => {
      const withUtility = SCHEMA.replace(
         "import { defineChannels, invoke, send }",
         "import { callUtility, defineChannels, invoke, send }",
      ).replace("note:", "work: callUtility<() => Promise<number>>(),\n   note:");
      await project.write({ "ipc/schema.ts": withUtility }, MANIFEST);
      const first = await generate({ cwd: project.dir });
      expect(first.files).toContain(abs("utility.ts"));
      await fsp.writeFile(`${project.dir}/ipc/schema.ts`, SCHEMA);
      expect((await check({ cwd: project.dir })).stale).toContain(abs("utility.ts"));

      const second = await generate({ cwd: project.dir });

      expect(second.files).not.toContain(abs("utility.ts"));
      expect(await exists(abs("utility.ts"))).toBe(false);
      expect(await check({ cwd: project.dir })).toEqual({ stale: [] });
   });
});
