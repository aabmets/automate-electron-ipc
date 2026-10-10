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

import fs from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { watchSchema } from "@src/watch.js";
import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { createFakeWatch, createRunTracker } from "./fake-watch.js";

export const DEBOUNCE = 100;

export const posix = (file: string): string => file.replaceAll("\\", "/");

/** Lets the debounce time pass, and waits until the watcher has reported `runs` runs. */
async function settle(tracker: ReturnType<typeof createRunTracker>, runs: number) {
   await vi.advanceTimersByTimeAsync(DEBOUNCE);
   await tracker.until(runs);
}

/**
 * The setup of the tests of `watchSchema`: a temp project whose `ipcDataDir` is `ipc`, a fake clock,
 * fake watchers and a mocked `ipcAutomation`, which the caller mocks with `vi.mock`. Registers its
 * own hooks, so call it inside a `describe`.
 */
export function useWatchProject(ipcAutomation: Mock) {
   const state = { dir: "", ipcDir: "" };
   const closers: (() => void)[] = [];
   const spies = {} as { warn: Mock; error: Mock };

   const writeManifest = (ipcDataDir: string) =>
      fsp.writeFile(
         path.join(state.dir, "package.json"),
         JSON.stringify({ name: "p", config: { autoipc: { ipcDataDir } } }),
      );

   /** Starts a watcher on the given `watch`, and waits for its first run. */
   async function startWith(
      watch: typeof fs.watch,
      options: { cwd?: string; configFile?: string } = {},
   ) {
      const tracker = createRunTracker();
      const first = tracker.until(1);
      const close = watchSchema(
         { cwd: state.dir, ...options },
         { watch, debounceMs: DEBOUNCE, onRun: tracker.onRun },
      );
      closers.push(close);
      await first;
      return { tracker, close };
   }

   /** Starts a watcher with fake files and a fake clock, and waits for its first run. */
   async function start(options: { cwd?: string; configFile?: string } = {}) {
      const fake = createFakeWatch();
      return { ...fake, ...(await startWith(fake.watch, options)) };
   }

   beforeEach(async () => {
      state.dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-watch-"));
      state.ipcDir = posix(path.join(state.dir, "ipc"));
      await fsp.mkdir(state.ipcDir);
      await writeManifest("ipc");
      ipcAutomation.mockReset();
      ipcAutomation.mockResolvedValue(undefined);
      spies.warn = vi.spyOn(console, "warn").mockImplementation(() => undefined) as Mock;
      spies.error = vi.spyOn(console, "error").mockImplementation(() => undefined) as Mock;
      vi.useFakeTimers();
   });

   afterEach(async () => {
      for (const close of closers.splice(0)) {
         close();
      }
      vi.useRealTimers();
      vi.restoreAllMocks();
      await fsp.rm(state.dir, { recursive: true, force: true });
   });

   return { state, spies, writeManifest, start, startWith, settle };
}
