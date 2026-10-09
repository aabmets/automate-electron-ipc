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
import path from "node:path";
import type * as t from "@types";
import { ipcAutomation } from "./automation.js";
import cfg from "./config.js";
import { CONFIG_FILE_NAMES } from "./config-file.js";
import logger from "./logger.js";
import utils from "./utils.js";

/** What a change under a watched directory is about: the schema, or the config of the run. */
type ChangeKind = "schema" | "config";

/** One watched directory, with the rules that pick the names in it that start a run. */
interface WatchTarget {
   dir: string;
   recursive: boolean;
   classify: (name: string) => ChangeKind | null;
}

export interface WatchDeps {
   /** Replaces `fs.watch`; unit tests give it a fake. */
   watch?: typeof fs.watch;
   /** How long the watcher waits for more changes before it runs. Default 100. */
   debounceMs?: number;
   /** Called after every run, with the error that the run failed with, or `null`. */
   onRun?: (error: unknown | null) => void;
}

const MANIFEST_FILES = ["package.json", "tsconfig.json"];

/** The names in the project root that configure a run: the manifest, tsconfig and the config file. */
function rootTargets(projectRoot: string, configFile?: string): WatchTarget[] {
   const given = configFile === undefined ? null : utils.toPosix(path.resolve(configFile));
   const targets: WatchTarget[] = [
      {
         dir: projectRoot,
         recursive: false,
         classify: (name) =>
            MANIFEST_FILES.includes(name) || (CONFIG_FILE_NAMES as readonly string[]).includes(name)
               ? "config"
               : null,
      },
   ];
   if (given !== null) {
      targets.push({
         dir: path.posix.dirname(given),
         recursive: false,
         classify: (name) => (name === path.posix.basename(given) ? "config" : null),
      });
   }
   return targets;
}

/**
 * Only the schema file and the source files in the schema directory are schema changes. The
 * generated files sit next to `schema.ts`, so any other name would let every run start the next.
 */
function schemaTarget(ipcDataDir: string): WatchTarget {
   return {
      dir: ipcDataDir,
      recursive: true,
      classify: (name) =>
         name === "schema.ts" || (name.startsWith("schema/") && utils.isSchemaSourceFile(name))
            ? "schema"
            : null,
   };
}

/** Joins the targets that watch the same directory into one. */
function mergeTargets(targets: WatchTarget[]): WatchTarget[] {
   const byDir = new Map<string, WatchTarget>();
   for (const target of targets) {
      const known = byDir.get(target.dir);
      byDir.set(
         target.dir,
         known === undefined
            ? target
            : {
                 dir: target.dir,
                 recursive: known.recursive || target.recursive,
                 classify: (name) => known.classify(name) ?? target.classify(name),
              },
      );
   }
   return [...byDir.values()];
}

function targetsOf(config: t.IPCResolvedConfig, configFile?: string): WatchTarget[] {
   return mergeTargets([
      schemaTarget(path.posix.dirname(config.ipcSchema.path)),
      ...rootTargets(config.projectRoot, configFile),
   ]);
}

/**
 * The directories to watch for a run: the schema directory (`ipcDataDir`, recursive), the project
 * root (not recursive, for `package.json`, `tsconfig.json` and `autoipc.config.*`), and the
 * directory of the config file when one is given. They are directories, not files, because editors
 * that save atomically replace the inode of a file.
 *
 * @param config - The resolved config of the run.
 * @param [configFile] - The config file of the run, absolute or relative to the working directory.
 * @returns The absolute paths of the directories, with `/` separators.
 */
export function watchedPaths(config: t.IPCResolvedConfig, configFile?: string): string[] {
   return targetsOf(config, configFile).map((target) => target.dir);
}

/**
 * Tells what a changed file is about for a run: a schema source (the schema file or a source file
 * in the schema directory), a file that configures the run (`package.json`, `tsconfig.json`, the
 * config file), or neither. It applies the rules of `--watch`, so generated files are never a change.
 *
 * @param config - The resolved config of the run.
 * @param file - The absolute path of the changed file.
 * @param [configFile] - The config file of the run, absolute or relative to the working directory.
 * @returns `"schema"`, `"config"`, or `null` for a file that does not start a run.
 */
export function classifyChange(
   config: t.IPCResolvedConfig,
   file: string,
   configFile?: string,
): ChangeKind | null {
   const posixFile = utils.toPosix(path.resolve(file));
   for (const target of targetsOf(config, configFile)) {
      const name = path.posix.relative(target.dir, posixFile);
      const inside = name !== "" && !name.startsWith("..") && !path.posix.isAbsolute(name);
      if (inside && (target.recursive || !name.includes("/"))) {
         const kind = target.classify(name);
         if (kind) {
            return kind;
         }
      }
   }
   return null;
}

/**
 * Runs the generator, and runs it again whenever the schema or the config changes, until the
 * returned function is called. A burst of changes causes one run; changes during a run cause one
 * more run after it. A run that fails is printed and does not stop the watcher.
 *
 * @param options - The options of each run.
 * @param [deps] - Replacements for the file watcher, the delay and the run report.
 * @returns A function that closes every watcher.
 */
export function watchSchema(options: t.RunOptions, deps: WatchDeps = {}): () => void {
   const { watch = fs.watch, debounceMs = 100, onRun } = deps;
   const configFile =
      options.configFile === undefined
         ? undefined
         : path.resolve(options.cwd ?? process.cwd(), options.configFile);
   const watchers: fs.FSWatcher[] = [];
   let watched: string[] = [];
   let timer: ReturnType<typeof setTimeout> | undefined;
   let closed = false;
   let running = false;
   let dirty = false;
   let stale = true;
   let failed = false;

   const closeWatchers = () => {
      for (const watcher of watchers.splice(0)) {
         watcher.close();
      }
   };

   const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => run().catch(logger.fatalError), debounceMs);
   };

   const onChange = (kind: ChangeKind) => {
      if (closed) {
         return;
      }
      stale ||= kind === "config";
      if (running) {
         dirty = true;
      } else {
         schedule();
      }
   };

   /** Falls back to the project root, so that fixing a broken config starts a run. */
   async function resolveTargets(): Promise<WatchTarget[]> {
      try {
         return targetsOf(await cfg.getResolvedConfig(options), configFile);
      } catch {
         let root: string;
         try {
            root = utils.resolveUserProjectPath("", options.cwd);
         } catch {
            root = utils.toPosix(path.resolve(options.cwd ?? process.cwd()));
         }
         return mergeTargets(rootTargets(root, configFile));
      }
   }

   /** Watches the directories of the current config, when they are not watched already. */
   async function sync(): Promise<void> {
      stale = false;
      const targets = await resolveTargets();
      const dirs = targets.map((target) => target.dir);
      const unchanged = dirs.length === watched.length && dirs.every((d, i) => d === watched[i]);
      if (closed || (unchanged && !failed)) {
         return;
      }
      closeWatchers();
      failed = false;
      for (const target of targets) {
         try {
            const watcher = watch(target.dir, { recursive: target.recursive }, (_event, name) => {
               // A platform that gives no name cannot be filtered, and would loop on its own output.
               const kind = name ? target.classify(utils.toPosix(String(name))) : null;
               if (kind) {
                  onChange(kind);
               }
            });
            watcher.on("error", logger.fatalError);
            watchers.push(watcher);
         } catch (error) {
            // A directory that does not exist yet may exist after the next run; sync tries again.
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
               failed = true;
            } else {
               logger.fatalError(error);
            }
         }
      }
      watched = dirs;
      stale ||= failed;
      if (!unchanged) {
         logger.watching(dirs);
      }
   }

   async function run(): Promise<void> {
      timer = undefined;
      running = true;
      dirty = false;
      let failure: unknown = null;
      try {
         await ipcAutomation(options);
      } catch (error) {
         failure = error;
         logger.fatalError(error);
      }
      if (stale) {
         await sync();
      }
      running = false;
      onRun?.(failure);
      if (dirty && !closed) {
         schedule();
      }
   }

   sync()
      .then(() => (closed ? undefined : run()))
      .catch(logger.fatalError);

   return () => {
      closed = true;
      clearTimeout(timer);
      closeWatchers();
   };
}
