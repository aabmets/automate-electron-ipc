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
import { watchSchema } from "@src/watch.js";
import { createFakeWatch } from "@testutils/watch/fake-watch.js";
import { DEBOUNCE, posix, useWatchProject } from "@testutils/watch/watch-project.js";
import { describe, expect, it, vi } from "vitest";

const ipcAutomation = vi.hoisted(() => vi.fn());
vi.mock("@src/automation.js", () => ({ ipcAutomation }));

describe("watchSchema runs", () => {
   const { state, spies, start, settle } = useWatchProject(ipcAutomation);

   it("runs at once, then watches the schema directory and the project root", async () => {
      const { open } = await start();

      expect(ipcAutomation).toHaveBeenCalledTimes(1);
      expect(ipcAutomation).toHaveBeenCalledWith({ cwd: state.dir });
      const watchers = open();
      expect([...watchers.keys()].sort()).toEqual([state.ipcDir, posix(state.dir)].sort());
      expect(watchers.get(state.ipcDir)?.recursive).toBe(true);
      expect(watchers.get(posix(state.dir))?.recursive).toBe(false);
      expect(String(spies.warn.mock.calls[0][0])).toContain("Watching for changes in:");
   });

   it("merges a burst of changes into one run", async () => {
      const { open, tracker } = await start();
      const schema = open().get(state.ipcDir);

      schema?.change("schema.ts");
      await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
      schema?.change("schema.ts");
      schema?.change("schema/users.ts");
      // Each change restarts the wait, so nothing has run yet.
      await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
      expect(ipcAutomation).toHaveBeenCalledTimes(1);
      await settle(tracker, 2);

      expect(ipcAutomation).toHaveBeenCalledTimes(2);
   });

   it("runs once more, not once per change, for the changes that come during a run", async () => {
      let release: () => void = () => undefined;
      const { open, tracker } = await start();
      ipcAutomation.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
      const schema = open().get(state.ipcDir);

      schema?.change("schema.ts");
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
      expect(ipcAutomation).toHaveBeenCalledTimes(2);
      schema?.change("schema.ts");
      schema?.change("schema/a.ts");
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
      // The run is still going, so the changes wait for it.
      expect(ipcAutomation).toHaveBeenCalledTimes(2);
      release();
      await tracker.until(2);
      await settle(tracker, 3);
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);

      expect(ipcAutomation).toHaveBeenCalledTimes(3);
   });

   it("prints a failing run, keeps watching, and leaves the exit code alone", async () => {
      const { open, tracker } = await start();
      const failure = new Error("Syntax error in schema file 'schema.ts:1:2': oops");
      ipcAutomation.mockRejectedValueOnce(failure);
      const schema = open().get(state.ipcDir);

      schema?.change("schema.ts");
      await settle(tracker, 2);
      expect(tracker.errors[1]).toBe(failure);
      expect(String(spies.error.mock.calls[0][0])).toContain("Syntax error in schema file");
      expect(process.exitCode).toBeUndefined();
      expect([...open().keys()]).toContain(state.ipcDir);

      schema?.change("schema.ts");
      await settle(tracker, 3);
      expect(tracker.errors[2]).toBeNull();
      expect(ipcAutomation).toHaveBeenCalledTimes(3);
   });

   it("ignores the generated files and other names that no run reads", async () => {
      const { open, tracker } = await start();
      const schema = open().get(state.ipcDir);
      const root = open().get(posix(state.dir));

      for (const name of ["main.ts", "preload.ts", "window.d.ts", "schema/a.d.ts", "schema/n.md"]) {
         schema?.change(name);
      }
      schema?.change(null);
      for (const name of ["README.md", "src", "index.ts", ".autoipc.config.ab12.mjs"]) {
         root?.change(name);
      }
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
      expect(ipcAutomation).toHaveBeenCalledTimes(1);

      // The same watcher does react to the names that count.
      for (const [watcher, name] of [
         [schema, "schema.ts"],
         [schema, "schema/deep/b.mts"],
         [root, "package.json"],
         [root, "tsconfig.json"],
         [root, "autoipc.config.ts"],
      ] as const) {
         watcher?.change(name);
         // biome-ignore lint/performance/noAwaitInLoops: each change is settled before the next
         await settle(tracker, tracker.errors.length + 1);
      }
      expect(ipcAutomation).toHaveBeenCalledTimes(6);
   });

   it("closes every watcher, and does not run for a change that was pending", async () => {
      const { watchers, open, tracker, close } = await start();
      const schema = open().get(state.ipcDir);

      schema?.change("schema.ts");
      close();
      expect(watchers.every((w) => w.closed)).toBe(true);
      schema?.change("schema.ts");
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);

      expect(ipcAutomation).toHaveBeenCalledTimes(1);
      expect(tracker.errors).toHaveLength(1);
   });

   it("does nothing when it is closed before its first run", async () => {
      let resolveConfig: (config: unknown) => void = () => undefined;
      vi.spyOn(cfg, "getResolvedConfig").mockImplementation(
         () => new Promise((resolve) => (resolveConfig = resolve)),
      );
      const fake = createFakeWatch();
      const close = watchSchema({ cwd: state.dir }, { watch: fake.watch, debounceMs: DEBOUNCE });

      close();
      resolveConfig({ projectRoot: state.dir, ipcSchema: { path: `${state.ipcDir}/schema.ts` } });
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);

      expect(fake.watchers).toHaveLength(0);
      expect(ipcAutomation).not.toHaveBeenCalled();
   });
});
