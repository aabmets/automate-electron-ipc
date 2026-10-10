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

import { type ChildProcess, spawn } from "node:child_process";

/** The time that a stopped process gets to clean up before it is killed. */
const KILL_GRACE_MS = 3_000;

export function startElectron(binary: string, appDir: string): ChildProcess {
   const args = [appDir];
   // Chromium refuses to start as root without this, and CI images whose kernel does not allow
   // the sandbox helper need it as well (ELECTRON_NO_SANDBOX=1). It turns off the sandbox helper
   // of Chromium only: the windows still use `sandbox: true`, which the tests check in the preload.
   if (process.getuid?.() === 0 || process.env.ELECTRON_NO_SANDBOX === "1") {
      args.unshift("--no-sandbox");
   }
   const needsDisplay =
      process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
   const [command, commandArgs] = needsDisplay
      ? ["xvfb-run", ["-a", binary, ...args]]
      : [binary, args];
   const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" };
   // biome-ignore lint/performance/noDelete: an env var which exists must not be set to "undefined"
   delete env.ELECTRON_RUN_AS_NODE;
   return spawn(command, commandArgs, {
      cwd: appDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // A group of its own, so that xvfb-run, Xvfb and Electron are stopped together.
      detached: process.platform !== "win32",
   });
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
   try {
      if (process.platform !== "win32" && child.pid !== undefined) {
         process.kill(-child.pid, signal);
      } else {
         child.kill(signal);
      }
   } catch {
      // The process is already gone.
   }
}

/** Whether any process of the group of `child` is still alive. */
export function isGroupAlive(child: ChildProcess): boolean {
   if (child.pid === undefined || process.platform === "win32") {
      return child.exitCode === null && child.signalCode === null;
   }
   try {
      process.kill(-child.pid, 0);
      return true;
   } catch {
      return false;
   }
}

interface Outcome {
   timedOut: boolean;
   code: number | null;
   signal: NodeJS.Signals | null;
}

export function waitForExit(
   child: ChildProcess,
   timeoutMs: number,
   output: () => string,
): Promise<Outcome> {
   return new Promise((resolve, reject) => {
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
         timedOut = true;
         // SIGTERM lets xvfb-run remove its files, SIGKILL stops what does not listen.
         signalGroup(child, "SIGTERM");
         killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), KILL_GRACE_MS);
      }, timeoutMs);
      child.once("error", (error) => {
         clearTimeout(timer);
         clearTimeout(killTimer);
         reject(new Error(`Electron could not be started: ${error.message}\n${output()}`));
      });
      child.once("close", (code, signal) => {
         clearTimeout(timer);
         clearTimeout(killTimer);
         resolve({ timedOut, code, signal });
      });
   });
}

/** Waits until the group of `child` is gone, for at most `timeoutMs`. */
async function waitForGroup(
   child: ChildProcess,
   timeoutMs: number,
   deadline = Date.now() + timeoutMs,
): Promise<void> {
   if (isGroupAlive(child) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await waitForGroup(child, timeoutMs, deadline);
   }
}

/**
 * Stops whatever is left of the group of `child`, once its main process ended. xvfb-run takes a
 * moment to stop Xvfb, and an Xvfb which is killed before that leaves its lock file behind, so
 * the group gets time to end by itself before it is signalled.
 */
export async function reap(child: ChildProcess): Promise<void> {
   await waitForGroup(child, KILL_GRACE_MS);
   if (isGroupAlive(child)) {
      signalGroup(child, "SIGTERM");
      await waitForGroup(child, KILL_GRACE_MS);
   }
   if (isGroupAlive(child)) {
      signalGroup(child, "SIGKILL");
      await waitForGroup(child, KILL_GRACE_MS);
   }
}
