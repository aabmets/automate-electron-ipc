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

import path from "node:path";
import type * as t from "../types/vite.js";
import { generate } from "./api.js";
import cfg from "./config.js";
import logger from "./logger.js";
import { classifyChange, watchedPaths } from "./watch.js";

/** The run that goes on for a project, and the one more run that waits for it. */
interface Flight {
   running: Promise<unknown> | null;
   queued: Promise<unknown> | null;
}

/**
 * electron-vite runs the main, preload and renderer configs in one process, each with its own
 * plugin instance, so the state of the runs is shared at module level, per project.
 */
const flights = new Map<string, Flight>();

function flightKey(options: t.GenerateOptions): string {
   return JSON.stringify([
      path.resolve(options.cwd ?? process.cwd()),
      options.configFile ?? null,
      options.overrides ?? null,
   ]);
}

/**
 * Generates the bindings, one run at a time per project. A caller that wants the files as they are
 * now joins the run that goes on (`fresh: false`). A caller that knows a file changed asks for
 * `fresh: true`: a run that is going may have read the file before the change, so exactly one more
 * run starts after it, and every such caller shares that one.
 */
function generateOnce(options: t.GenerateOptions, fresh: boolean): Promise<unknown> {
   const key = flightKey(options);
   const flight = flights.get(key) ?? { running: null, queued: null };
   flights.set(key, flight);

   const start = (): Promise<unknown> => {
      const run: Promise<unknown> = generate(options).finally(() => {
         if (flight.running === run) {
            flight.running = null;
         }
         if (flight.running === null && flight.queued === null) {
            flights.delete(key);
         }
      });
      flight.running = run;
      return run;
   };

   if (flight.running === null) {
      return start();
   }
   if (!fresh) {
      return flight.queued ?? flight.running;
   }
   flight.queued ??= flight.running
      .catch(() => undefined)
      .then(() => {
         flight.queued = null;
         return start();
      });
   return flight.queued;
}

/**
 * A Vite plugin that generates the IPC bindings when a build starts, and again whenever the schema
 * or the config changes while the dev server runs. It works in plain Vite and in electron-vite,
 * where each of the main, preload and renderer configs can use it: runs are shared between them.
 *
 * @param [options] - The options of each run, like the ones of `generate` from the API. `logger` is
 *    `true` unless set.
 * @returns The plugin.
 */
export function autoipc(options: t.GenerateOptions = {}): t.VitePluginLike {
   const runOptions: t.GenerateOptions = { ...options, logger: options.logger ?? true };
   // The config file is relative to `cwd`, which is how the paths of the watcher are resolved.
   const configFile =
      options.configFile === undefined
         ? undefined
         : path.resolve(options.cwd ?? process.cwd(), options.configFile);

   return {
      name: "automate-electron-ipc",

      async buildStart() {
         await generateOnce(runOptions, false);
      },

      async configureServer(server) {
         try {
            const config = await cfg.getResolvedConfig(runOptions);
            server.watcher.add(watchedPaths(config, configFile));
         } catch (error) {
            // The build reports a broken config; the dev server stays up.
            logger.fatalError(error);
         }
      },

      async handleHotUpdate({ file }) {
         let kind: ReturnType<typeof classifyChange>;
         try {
            const config = await cfg.getResolvedConfig(runOptions);
            kind = classifyChange(config, file, configFile);
         } catch {
            // With a broken config no file can be told apart: Vite handles the file as usual.
            return undefined;
         }
         if (kind === null) {
            return undefined;
         }
         try {
            await generateOnce(runOptions, true);
         } catch (error) {
            logger.fatalError(error);
         }
         return kind === "schema" ? [] : undefined;
      },
   };
}
