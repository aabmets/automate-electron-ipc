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
import { createRequire } from "node:module";
import path from "node:path";

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
