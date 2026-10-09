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
import utils from "@src/utils.js";
import { createFakeWatch } from "@testutils/watch/fake-watch.js";
import { DEBOUNCE, posix, useWatchProject } from "@testutils/watch/watch-project.js";
import { describe, expect, it, vi } from "vitest";

const ipcAutomation = vi.hoisted(() => vi.fn());
vi.mock("@src/automation.js", () => ({ ipcAutomation }));

describe("watchSchema and the config", () => {
   const { state, spies, writeManifest, start, startWith, settle } = useWatchProject(ipcAutomation);

   it("watches again when a config change moves the schema directory", async () => {
      const { watchers, open, tracker } = await start();
      const root = open().get(posix(state.dir));
      const oldSchema = open().get(state.ipcDir);
      await fsp.mkdir(path.join(state.dir, "other"));
      await writeManifest("other");

      root?.change("package.json");
      await settle(tracker, 2);

      expect(oldSchema?.closed).toBe(true);
      expect(root?.closed).toBe(true);
      expect([...open().keys()].sort()).toEqual(
         [path.join(state.dir, "other"), state.dir].map((p) => p.replaceAll("\\", "/")).sort(),
      );
      expect(watchers).toHaveLength(4);
      // A change in the new directory starts a run.
      open()
         .get(posix(path.join(state.dir, "other")))
         ?.change("schema.ts");
      await settle(tracker, 3);
      expect(ipcAutomation).toHaveBeenCalledTimes(3);
   });

   it("keeps its watchers when a config change leaves the directories as they were", async () => {
      const { watchers, open, tracker } = await start();

      open().get(posix(state.dir))?.change("tsconfig.json");
      await settle(tracker, 2);

      expect(watchers).toHaveLength(2);
      expect(watchers.every((w) => !w.closed)).toBe(true);
   });

   it("watches the project root while the config is broken, and the schema once it is fixed", async () => {
      await fsp.writeFile(
         path.join(state.dir, "package.json"),
         JSON.stringify({ name: "p", config: { autoipc: { nope: 1 } } }),
      );
      ipcAutomation.mockRejectedValueOnce(new Error("bad config"));
      const { open, tracker } = await start();
      expect([...open().keys()]).toEqual([posix(state.dir)]);

      await writeManifest("ipc");
      open().get(posix(state.dir))?.change("package.json");
      await settle(tracker, 2);

      expect([...open().keys()]).toContain(state.ipcDir);
   });

   it("watches the working directory when there is no project at all", async () => {
      vi.spyOn(utils, "resolveUserProjectPath").mockImplementation(() => {
         throw new Error("Cannot find the project root");
      });
      const { open } = await start();

      expect([...open().keys()]).toEqual([posix(state.dir)]);
   });

   it("waits for a schema directory that the first run creates", async () => {
      await fsp.rm(state.ipcDir, { recursive: true });
      ipcAutomation.mockImplementationOnce(() => fsp.mkdir(state.ipcDir));
      const { open } = await start();

      // The directory did not exist when the watcher started, which is not an error to report.
      expect(spies.error).not.toHaveBeenCalled();
      expect([...open().keys()]).toContain(state.ipcDir);
   });

   it("reports a watcher that cannot be made and one that fails later, and carries on", async () => {
      const fake = createFakeWatch();
      const refused = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
      const watch = ((...args: Parameters<typeof fake.watch>) => {
         if (args[0] === state.ipcDir) {
            throw refused;
         }
         return fake.watch(...args);
      }) as typeof fake.watch;
      await startWith(watch);
      expect(String(spies.error.mock.calls[0][0])).toContain("EMFILE");

      fake.watchers[0].emit("error", new Error("EPERM: the directory was removed"));
      expect(String(spies.error.mock.calls[1][0])).toContain("EPERM");
   });

   it("watches the directory of the given config file", async () => {
      const conf = path.join(state.dir, "conf");
      await fsp.mkdir(conf);
      await fsp.writeFile(
         path.join(conf, "ipc.config.json"),
         JSON.stringify({ ipcDataDir: "ipc" }),
      );
      await fsp.writeFile(path.join(state.dir, "package.json"), JSON.stringify({ name: "p" }));
      const { open, tracker } = await start({ configFile: "conf/ipc.config.json" });
      const watcher = open().get(conf.replaceAll("\\", "/"));
      expect(watcher).toBeDefined();

      watcher?.change("other.json");
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
      expect(ipcAutomation).toHaveBeenCalledTimes(1);
      watcher?.change("ipc.config.json");
      await settle(tracker, 2);
      expect(ipcAutomation).toHaveBeenCalledTimes(2);
   });

   it("tells the schema from the config in a directory that is both", async () => {
      await writeManifest(".");
      const { open, tracker } = await start();
      const only = open().get(posix(state.dir));
      expect(open().size).toBe(1);
      expect(only?.recursive).toBe(true);

      only?.change("schema.ts");
      await settle(tracker, 2);
      only?.change("package.json");
      await settle(tracker, 3);
      only?.change("main.ts");
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);

      expect(ipcAutomation).toHaveBeenCalledTimes(3);
   });
});
