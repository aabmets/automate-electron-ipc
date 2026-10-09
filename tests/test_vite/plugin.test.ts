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

import cfg from "@src/config.js";
import { autoipc } from "@src/vite.js";
import { withConfigProject } from "@testutils/config/config-project.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@src/api.js", () => ({ generate }));

const MANIFEST = { name: "project", config: { autoipc: { ipcDataDir: "ipc" } } };
const RESULT = { files: [], channels: 0 };

/** A `generate` that stays running until the test lets it finish. */
function holdGenerate() {
   const finishers: ((error?: Error) => void)[] = [];
   generate.mockImplementation(
      () =>
         new Promise((resolve, reject) => {
            finishers.push((error) => (error ? reject(error) : resolve(RESULT)));
         }),
   );
   return finishers;
}

describe("autoipc vite plugin", () => {
   const project = withConfigProject();
   let errorSpy: ReturnType<typeof vi.spyOn>;

   beforeEach(async () => {
      generate.mockReset().mockResolvedValue(RESULT);
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await project.write({ "ipc/schema.ts": "export default {};\n" }, MANIFEST);
   });
   afterEach(() => {
      vi.restoreAllMocks();
   });

   const file = (name: string) => `${project.root}/${name}`;

   it("is named, and implements the three hooks", () => {
      const plugin = autoipc();
      expect(plugin.name).toBe("automate-electron-ipc");
      expect(plugin.buildStart).toBeTypeOf("function");
      expect(plugin.configureServer).toBeTypeOf("function");
      expect(plugin.handleHotUpdate).toBeTypeOf("function");
   });

   describe("buildStart", () => {
      it("generates once, with the logger on", async () => {
         await autoipc({ cwd: project.dir }).buildStart?.();

         expect(generate).toHaveBeenCalledTimes(1);
         expect(generate).toHaveBeenCalledWith({ cwd: project.dir, logger: true });
      });

      it("keeps the logger setting of the user", async () => {
         await autoipc({ cwd: project.dir, logger: false }).buildStart?.();

         expect(generate).toHaveBeenCalledWith({ cwd: project.dir, logger: false });
      });

      it("rethrows the error of the run, so that the build fails", async () => {
         generate.mockRejectedValue(new Error("bad schema"));

         await expect(autoipc({ cwd: project.dir }).buildStart?.()).rejects.toThrow("bad schema");
      });

      it("runs one generation for three instances that start together", async () => {
         const finishers = holdGenerate();
         const plugins = [1, 2, 3].map(() => autoipc({ cwd: project.dir }));

         const builds = plugins.map((plugin) => plugin.buildStart?.());
         await Promise.resolve();
         for (const finish of finishers) {
            finish();
         }
         await Promise.all(builds);

         expect(generate).toHaveBeenCalledTimes(1);
      });

      it("runs again for a build that starts after the previous one finished", async () => {
         const plugin = autoipc({ cwd: project.dir });
         await plugin.buildStart?.();
         await plugin.buildStart?.();

         expect(generate).toHaveBeenCalledTimes(2);
      });

      it("does not share a run between projects", async () => {
         const finishers = holdGenerate();
         const builds = [
            autoipc({ cwd: project.dir }).buildStart?.(),
            autoipc({ cwd: `${project.dir}/other` }).buildStart?.(),
         ];
         await Promise.resolve();
         for (const finish of finishers) {
            finish();
         }
         await Promise.all(builds);

         expect(generate).toHaveBeenCalledTimes(2);
      });
   });

   describe("configureServer", () => {
      it("adds the watched paths to the watcher of the server", async () => {
         const add = vi.fn();

         await autoipc({ cwd: project.dir }).configureServer?.({ watcher: { add } });

         expect(add).toHaveBeenCalledTimes(1);
         expect(add).toHaveBeenCalledWith([file("ipc"), project.root]);
      });

      it("adds the directory of the config file", async () => {
         await project.write({ "conf/ipc.config.json": '{ "ipcDataDir": "ipc" }' });
         const add = vi.fn();

         await autoipc({ cwd: project.dir, configFile: "conf/ipc.config.json" }).configureServer?.({
            watcher: { add },
         });

         expect(add).toHaveBeenCalledWith([file("ipc"), project.root, file("conf")]);
      });

      it("logs a config that cannot be read, and does not throw", async () => {
         await project.write({ "package.json": "{ not json" });
         const add = vi.fn();

         await expect(
            autoipc({ cwd: project.dir }).configureServer?.({ watcher: { add } }),
         ).resolves.toBeUndefined();

         expect(add).not.toHaveBeenCalled();
         expect(errorSpy).toHaveBeenCalled();
      });
   });

   describe("handleHotUpdate", () => {
      it.each(["ipc/schema.ts", "ipc/schema/channels.ts"])(
         "regenerates for the schema file %s, and keeps the page from reloading",
         async (name) => {
            const result = await autoipc({ cwd: project.dir }).handleHotUpdate?.({
               file: file(name),
            });

            expect(generate).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
         },
      );

      it.each(["package.json", "tsconfig.json"])(
         "regenerates for the config file %s, and leaves the update to Vite",
         async (name) => {
            const result = await autoipc({ cwd: project.dir }).handleHotUpdate?.({
               file: file(name),
            });

            expect(generate).toHaveBeenCalledTimes(1);
            expect(result).toBeUndefined();
         },
      );

      it.each([
         "src/renderer/App.tsx",
         "ipc/main.ts",
         "ipc/preload.ts",
         "ipc/window.d.ts",
         "ipc/schema/types.d.ts",
         "ipc/notes.txt",
         "elsewhere/package.json",
      ])("does not regenerate for %s", async (name) => {
         const result = await autoipc({ cwd: project.dir }).handleHotUpdate?.({
            file: file(name),
         });

         expect(generate).not.toHaveBeenCalled();
         expect(result).toBeUndefined();
      });

      it("logs the error of a run and does not throw", async () => {
         generate.mockRejectedValue(new Error("bad schema"));

         const result = await autoipc({ cwd: project.dir }).handleHotUpdate?.({
            file: file("ipc/schema.ts"),
         });

         expect(result).toEqual([]);
         expect(errorSpy.mock.calls.flat().join("\n")).toContain("bad schema");
      });

      it("queues exactly one more run for edits that come during a run", async () => {
         const finishers = holdGenerate();
         const plugin = autoipc({ cwd: project.dir });

         const resolving = vi.spyOn(cfg, "getResolvedConfig");
         const first = plugin.handleHotUpdate?.({ file: file("ipc/schema.ts") });
         await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
         const second = plugin.handleHotUpdate?.({ file: file("ipc/schema.ts") });
         const third = plugin.handleHotUpdate?.({ file: file("ipc/schema/a.ts") });
         // Both edits have read the config, so both have asked for a run by now.
         await Promise.all(resolving.mock.results.map((result) => result.value));
         expect(generate).toHaveBeenCalledTimes(1);

         finishers[0]();
         await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
         finishers[1]();
         await Promise.all([first, second, third]);

         expect(generate).toHaveBeenCalledTimes(2);
      });
   });
});
