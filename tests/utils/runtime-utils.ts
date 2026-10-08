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

import { EventEmitter } from "node:events";
import vm from "node:vm";
import { transformSync } from "@swc/core";
import { vi } from "vitest";

/**
 * Runs a generated TypeScript file in this process and returns its exports.
 * The types are stripped with swc, and `require` serves only the given modules,
 * such as a fake `electron`.
 */
export function loadGenerated(source: string, modules: Record<string, unknown>): any {
   const { code } = transformSync(source, {
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
   });
   const exports: Record<string, unknown> = {};
   const require = (name: string) => {
      if (!(name in modules)) {
         throw new Error(`Generated code required unexpected module '${name}'`);
      }
      return modules[name];
   };
   const run = vm.runInThisContext(`(function (exports, require) {${code}\n})`);
   run(exports, require);
   return exports;
}

/** A BrowserWindow stand-in which emits window events and records what is sent to it. */
export function createFakeWindow() {
   const win = new EventEmitter() as EventEmitter & {
      webContents: { send: ReturnType<typeof vi.fn> };
      destroyed: boolean;
      isDestroyed: () => boolean;
   };
   win.webContents = { send: vi.fn() };
   win.destroyed = false;
   win.isDestroyed = () => win.destroyed;
   return win;
}

/** A fake `electron` module for the generated main process bindings. */
export function createFakeElectron() {
   return {
      ipcMain: { on: vi.fn(), handle: vi.fn() },
      MessageChannelMain: class {},
   };
}
