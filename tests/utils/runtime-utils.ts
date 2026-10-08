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
import { parseSync, transformSync } from "@swc/core";
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

/** Contents stand-in of the helpers below: an emitter that has a `loading` flag behind `isLoading()`. */
type LoadingContents = EventEmitter & { loading: boolean };

/** A main-frame navigation begins, which Electron announces before the page loads. */
export function startLoading(contents: LoadingContents) {
   contents.loading = true;
   contents.emit("did-start-loading");
   contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
}

/**
 * The page finishes loading the way Electron reports it: `isLoading()` is still true while
 * `did-finish-load` fires, and turns false only at `did-stop-loading`.
 */
export function finishLoading(contents: LoadingContents) {
   contents.emit("did-finish-load");
   contents.loading = false;
   contents.emit("did-stop-loading");
}

/** A fake `electron` module for the generated main process bindings. */
export function createFakeElectron() {
   return {
      ipcMain: {
         on: vi.fn(),
         once: vi.fn(),
         off: vi.fn(),
         handle: vi.fn(),
         handleOnce: vi.fn(),
         removeHandler: vi.fn(),
      },
      MessageChannelMain: class {},
   };
}

/** A fake `electron` module for the generated preload script, which records what it exposes. */
export function createFakePreloadElectron() {
   const exposed: Record<string, any> = {};
   return {
      exposed,
      electron: {
         contextBridge: {
            exposeInMainWorld: vi.fn((key: string, api: unknown) => {
               exposed[key] = api;
            }),
         },
         ipcRenderer: {
            invoke: vi.fn(),
            send: vi.fn(),
            on: vi.fn(),
            once: vi.fn(),
            removeListener: vi.fn(),
         },
      },
   };
}

/** The dotted paths of the callable members of an object, such as `chat.send`. */
export function callablePaths(api: Record<string, unknown>, prefix = ""): string[] {
   return Object.entries(api)
      .flatMap(([key, value]) => {
         const path = `${prefix}${key}`;
         return typeof value === "function"
            ? [path]
            : callablePaths(value as Record<string, unknown>, `${path}.`);
      })
      .sort();
}

/**
 * The dotted paths of the function members of the `IpcApi` interface in the text of a generated
 * `window.d.ts`, read from its syntax tree.
 */
export function windowIpcPaths(windowTypes: string): string[] {
   const module = parseSync(windowTypes, { syntax: "typescript", target: "esnext" });
   const collect = (members: any[], prefix: string): string[] =>
      members.flatMap((member) => {
         const path = `${prefix}${member.key.value}`;
         const type = member.typeAnnotation?.typeAnnotation;
         return type?.type === "TsTypeLiteral" ? collect(type.members, `${path}.`) : [path];
      });
   const find = (node: any): string[] | null => {
      if (node?.type === "TsInterfaceDeclaration" && node.id.value === "IpcApi") {
         return collect(node.body.body, "");
      }
      for (const child of Object.values(node ?? {})) {
         for (const item of Array.isArray(child) ? child : [child]) {
            const found = item && typeof item === "object" ? find(item) : null;
            if (found) {
               return found;
            }
         }
      }
      return null;
   };
   return (find(module) ?? []).sort();
}

/** An async iterable which the test feeds by hand, and which records `return()`. */
export function createSource() {
   const waiting: {
      resolve: (r: IteratorResult<unknown>) => void;
      reject: (e: unknown) => void;
   }[] = [];
   const buffered: ({ result: IteratorResult<unknown> } | { error: unknown })[] = [];
   const feed = (item: (typeof buffered)[number]) => {
      const waiter = waiting.shift();
      if (!waiter) {
         buffered.push(item);
      } else if ("error" in item) {
         waiter.reject(item.error);
      } else {
         waiter.resolve(item.result);
      }
   };
   const iterator = {
      next: vi.fn(
         () =>
            new Promise<IteratorResult<unknown>>((resolve, reject) => {
               const item = buffered.shift();
               if (!item) {
                  waiting.push({ resolve, reject });
               } else if ("error" in item) {
                  reject(item.error);
               } else {
                  resolve(item.result);
               }
            }),
      ),
      return: vi.fn(async () => ({ done: true, value: undefined })),
   };
   return {
      iterable: { [Symbol.asyncIterator]: () => iterator },
      iterator,
      push: (value: unknown) => feed({ result: { done: false, value } }),
      end: () => feed({ result: { done: true, value: undefined } }),
      fail: (error: unknown) => feed({ error }),
   };
}
