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
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { transformSync } from "@swc/core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { type E2EProject, runFixture } from "./e2e-utils.js";

const RESULT_MARK = "@@ELECTRON-RESULT@@";

/** How long a scenario may run in the Electron process before it fails. */
const SCENARIO_TIMEOUT_MS = 20_000;
/** How long the Electron process may run before it is killed. */
const PROCESS_TIMEOUT_MS = 120_000;
/** The time that a stopped process gets to clean up before it is killed. */
const KILL_GRACE_MS = 3_000;
/** The timeout of the hook which runs a group, which is more than the process may take. */
export const GROUP_HOOK_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 30_000;

/**
 * What a scenario can use in the Electron main process. The scenario function is turned into
 * text and runs there, so it must not use anything from the scope of the test file: the types
 * are `any`, since the generated bindings and `electron` are not visible to the test.
 */
export interface ScenarioContext {
   /** The `electron` module of the main process. */
   electron: any;
   /** The exports of the generated `main.ts`, loaded fresh for each scenario. */
   main: any;
   /** `main.ipc`. */
   ipc: any;
   /** The `data` of the group: the only way to share values with the scenarios. */
   data: Record<string, any>;
   /** `webPreferences` of a window which uses the generated preload script. */
   webPreferences: (options?: OpenOptions) => Record<string, unknown>;
   sleep: (ms: number) => Promise<void>;
   /**
    * Forks a utility process which runs `entry`, a function that is turned into text. It can use
    * `ipc` and `IpcUtilityError` of the generated `utility.ts`, and `process`, and nothing from the
    * scope of the test file. Resolves with the `UtilityProcess` once it has spawned, and the child
    * is killed when the scenario ends.
    */
   fork: (entry: () => unknown) => Promise<any>;
   /** Serves `html` at `url`, such as `app://main/index.html`. */
   serve: (url: string, html: string) => void;
   /** Opens a hidden window with the generated preload script, and waits until it loaded. */
   open: (options?: OpenOptions) => Promise<any>;
   /** Creates a hidden window which has not loaded anything. */
   blank: (options?: OpenOptions) => any;
   /** Runs `fn(...args)` in the page of a window, contents or frame, and returns its result. */
   evaluate: (target: any, fn: (...args: any[]) => unknown, ...args: unknown[]) => Promise<any>;
   /** Runs `fn(...args)` in the page until it returns something truthy, and returns that. */
   until: (target: any, fn: (...args: any[]) => unknown, ...args: unknown[]) => Promise<any>;
   /** Calls `fn` in the main process until it returns something truthy, and returns that. */
   waitFor: <T>(fn: () => T | Promise<T>, what?: string) => Promise<NonNullable<Awaited<T>>>;
}

export interface OpenOptions {
   /** The page to load. Defaults to `app://main/index.html`. */
   url?: string;
   /** Run the preload script in the frames of the page as well. */
   subframes?: boolean;
   /**
    * The scope whose preload script the window uses, as `preload.<scope>.js`. It only gives the page
    * the API of the scope: the window is not registered in the scope, which the scenario does.
    */
   scope?: string;
   /** More `webPreferences`, which win over the defaults. */
   webPreferences?: Record<string, unknown>;
}

export type Scenario = (ctx: ScenarioContext) => unknown;
export type ScenarioResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface ElectronRun {
   results: Record<string, ScenarioResult>;
   /** Errors which nobody caught in the main process. */
   uncaught: string[];
   /** Everything that the process printed. */
   output: string;
   /** The generated files of the fixture. */
   generated: E2EProject["generated"];
}

export interface RunOptions {
   fixture: string;
   scenarios: Record<string, Scenario>;
   /** JSON values for `ctx.data`, since the scenarios cannot use the scope of the test file. */
   data?: Record<string, unknown>;
   /** Overrides the time that a scenario may take. */
   scenarioTimeoutMs?: number;
   /** Overrides the time that the whole process may take. */
   timeoutMs?: number;
   /** Called with the process right after it was started. */
   onSpawn?: (info: { child: ChildProcess; appDir: string }) => void;
}

export type ElectronSupport = { ok: true; binary: string } | { ok: false; reason: string };

export interface SupportProbe {
   env?: NodeJS.ProcessEnv;
   platform?: NodeJS.Platform;
   /** Returns the path of the Electron binary, or throws. */
   resolveBinary?: () => string;
   /** Whether `file` is an executable which can be found in the PATH. */
   hasExecutable?: (file: string) => boolean;
}

function defaultResolveBinary(): string {
   return createRequire(import.meta.url)("electron") as string;
}

function defaultHasExecutable(file: string): boolean {
   return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
      try {
         fs.accessSync(path.join(dir, file), fs.constants.X_OK);
         return true;
      } catch {
         return false;
      }
   });
}

/** Tells whether the Electron binary can be started here, and if not, why. */
export function detectElectron(probe: SupportProbe = {}): ElectronSupport {
   const env = probe.env ?? process.env;
   const platform = probe.platform ?? process.platform;
   let binary: string;
   try {
      binary = (probe.resolveBinary ?? defaultResolveBinary)();
      if (typeof binary !== "string" || !fs.existsSync(binary)) {
         throw new Error(`there is no file at '${binary}'`);
      }
   } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return {
         ok: false,
         reason: `the Electron binary is not installed (run 'node node_modules/electron/install.js'): ${cause}`,
      };
   }
   if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
      if (!(probe.hasExecutable ?? defaultHasExecutable)("xvfb-run")) {
         return {
            ok: false,
            reason: "there is no display ($DISPLAY is not set) and 'xvfb-run' is not installed",
         };
      }
   }
   return { ok: true, binary };
}

/** `run` runs the tests, `skip` skips them, and `fail` makes them fail. */
export function electronGate(support: ElectronSupport, env = process.env): "run" | "skip" | "fail" {
   if (support.ok) {
      return "run";
   }
   return env.REQUIRE_ELECTRON === "1" ? "fail" : "skip";
}

async function compileGenerated(ipcDir: string, outDir: string): Promise<void> {
   const entries = await fsp.readdir(ipcDir, { recursive: true, withFileTypes: true });
   for (const entry of entries) {
      if (!(entry.isFile() && entry.name.endsWith(".ts")) || entry.name.endsWith(".d.ts")) {
         continue;
      }
      const source = path.join(entry.parentPath, entry.name);
      let { code } = transformSync(await fsp.readFile(source, "utf8"), {
         jsc: { parser: { syntax: "typescript" }, target: "es2022" },
         module: { type: "commonjs" },
      });
      if (/^preload(\.[\w-]+)?\.ts$/.test(entry.name)) {
         // The preload script is one file which only requires `electron`, as a sandboxed one must.
         // This tells the tests that it really runs sandboxed and in an isolated context.
         code += `\nrequire("electron").contextBridge.exposeInMainWorld("__env", { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated });\n`;
      }
      const target = path.join(outDir, path.relative(ipcDir, source)).replace(/\.ts$/, ".js");
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, code);
   }
}

function startElectron(binary: string, appDir: string): ChildProcess {
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

function waitForExit(
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
async function waitForGroup(child: ChildProcess, timeoutMs: number): Promise<void> {
   const deadline = Date.now() + timeoutMs;
   while (isGroupAlive(child) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
   }
}

/**
 * Stops whatever is left of the group of `child`, once its main process ended. xvfb-run takes a
 * moment to stop Xvfb, and an Xvfb which is killed before that leaves its lock file behind, so
 * the group gets time to end by itself before it is signalled.
 */
async function reap(child: ChildProcess): Promise<void> {
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

/**
 * Runs the scenarios against the generated bindings of a fixture in the Electron binary of this
 * repo, in one process, and returns what they returned.
 *
 * The temp dir and the process are gone when this returns or throws.
 */
export async function runElectronGroup(options: RunOptions): Promise<ElectronRun> {
   const support = detectElectron();
   if (!support.ok) {
      throw new Error(`Electron cannot run here: ${support.reason}`);
   }
   const project = await runFixture(options.fixture);
   const appDir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-electron-"));
   let child: ChildProcess | undefined;
   try {
      await compileGenerated(path.join(project.dir, project.ipcDataDir), path.join(appDir, "ipc"));
      await fsp.copyFile(
         path.join(import.meta.dirname, "electron-runner.cjs"),
         path.join(appDir, "runner.cjs"),
      );
      await fsp.writeFile(
         path.join(appDir, "package.json"),
         JSON.stringify({ name: "electron-test-app", main: "runner.cjs" }),
      );
      await fsp.writeFile(
         path.join(appDir, "config.json"),
         JSON.stringify({
            ipcDir: "ipc",
            data: options.data ?? {},
            scenarioTimeoutMs: options.scenarioTimeoutMs ?? SCENARIO_TIMEOUT_MS,
         }),
      );
      const entries = Object.entries(options.scenarios).map(
         ([name, scenario]) => `${JSON.stringify(name)}: (${scenario.toString()})`,
      );
      await fsp.writeFile(
         path.join(appDir, "scenarios.cjs"),
         `module.exports = {\n${entries.join(",\n")}\n};\n`,
      );

      child = startElectron(support.binary, appDir);
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
         stdout += chunk;
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
         stderr += chunk;
      });
      const output = () => `${stdout}${stderr}`;
      options.onSpawn?.({ child, appDir });

      const outcome = await waitForExit(child, options.timeoutMs ?? PROCESS_TIMEOUT_MS, output);
      if (outcome.timedOut) {
         throw new Error(`Electron did not finish in time and was killed\n${output()}`);
      }
      const line = stdout.split("\n").find((entry) => entry.startsWith(RESULT_MARK));
      if (!line) {
         throw new Error(
            `Electron ended without a result (exit code ${outcome.code}, signal ${outcome.signal})\n${output()}`,
         );
      }
      const parsed = JSON.parse(line.slice(RESULT_MARK.length));
      return { ...parsed, output: output(), generated: project.generated };
   } finally {
      if (child) {
         await reap(child);
      }
      await fsp.rm(appDir, { recursive: true, force: true });
      await project.cleanup();
   }
}

/** What a test reads from the run of its group. */
export interface ElectronGroup {
   /** The value that the scenario returned. Throws the error of a scenario which failed. */
   value: <T = any>(name: string) => T;
   /** The uncaught errors of the main process, and everything that the process printed. */
   run: () => ElectronRun;
}

/**
 * Like `describe`, with one Electron process for all of the tests in it. The process runs the
 * scenarios once, before the tests, and the tests assert on what the scenarios returned.
 *
 * Without Electron or a display the tests are skipped, and with `REQUIRE_ELECTRON=1` they fail.
 */
export function describeElectron(
   title: string,
   fixture: string,
   scenarios: Record<string, Scenario>,
   body: (group: ElectronGroup) => void,
   data: Record<string, unknown> = {},
): void {
   let current: ElectronRun | undefined;
   const group: ElectronGroup = {
      run: () => {
         if (!current) {
            throw new Error("The Electron process has not run");
         }
         return current;
      },
      value: (name) => {
         const result = group.run().results[name];
         if (!result) {
            throw new Error(`There is no scenario '${name}'`);
         }
         if (!result.ok) {
            throw new Error(`The scenario '${name}' failed: ${result.error}`);
         }
         return result.value as never;
      },
   };
   const support = detectElectron();
   const gate = electronGate(support);
   if (gate === "run") {
      describe(title, () => {
         beforeAll(async () => {
            current = await runElectronGroup({ fixture, scenarios, data });
         }, GROUP_HOOK_TIMEOUT_MS);
         afterAll(() => {
            current = undefined;
         });
         body(group);
      });
   } else if (gate === "fail") {
      describe(title, () => {
         it("runs in Electron", () => {
            throw new Error(`REQUIRE_ELECTRON=1, but ${support.ok ? "" : support.reason}`);
         });
      });
   } else {
      // biome-ignore lint/suspicious/noSkippedTests: the tests are skipped on purpose without Electron
      describe.skip(title, () => body(group));
   }
}
