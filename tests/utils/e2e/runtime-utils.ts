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

/** Orders strings by code unit, which is what `sort()` does, and so keeps the order of the paths. */
const byCodeUnit = (a: string, b: string) => Number(a > b) - Number(a < b);

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
   const run = vm.compileFunction(code, ["exports", "require"]);
   run(exports, require);
   return exports;
}

/**
 * Waits `ms`, and then lets the real `MessagePort`s of Node deliver what is queued for them.
 *
 * A timer alone is not enough: when the process is descheduled for longer than `ms`, the timer
 * phase of the next turn of the event loop runs before its poll phase, which is where the queued
 * messages of the ports are delivered, so a plain timeout can resolve before any message arrived.
 * An immediate runs after the poll phase, and each round lets a message that a listener posted on
 * delivery go one hop further.
 */
export async function settlePorts(ms: number, rounds = 5): Promise<void> {
   await new Promise<void>((resolve) => setTimeout(resolve, ms));
   await afterImmediates(rounds);
}

/** Waits for `rounds` immediates, each one queued after the last one ran. */
async function afterImmediates(rounds: number): Promise<void> {
   if (rounds > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await afterImmediates(rounds - 1);
   }
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

/** The main-frame navigation commits, which replaces the document: Electron fires `did-navigate`. */
export function commitNavigation(contents: LoadingContents) {
   contents.emit("did-navigate", {}, "app://page", 200, "OK");
}

/**
 * The page finishes loading the way Electron reports it: the navigation commits, `isLoading()` is
 * still true while `did-finish-load` fires, and turns false only at `did-stop-loading`.
 */
export function finishLoading(contents: LoadingContents) {
   commitNavigation(contents);
   contents.emit("did-finish-load");
   contents.loading = false;
   contents.emit("did-stop-loading");
}

/**
 * A main-frame load fails the way Electron reports it: `did-fail-load`, then the
 * `did-finish-load` of the error page, which Electron shows without a `did-navigate`, and
 * `did-stop-loading`.
 */
export function failLoading(contents: LoadingContents, code = -105) {
   contents.emit("did-fail-load", {}, code, "ERR_FAILED", "app://x", true);
   contents.emit("did-finish-load");
   contents.loading = false;
   contents.emit("did-stop-loading");
}

/**
 * A main-frame navigation starts and stops without a commit, such as one that `will-navigate`
 * prevents, a download or a 204 response: no `did-navigate` and no `did-finish-load`.
 */
export function abortNavigation(contents: LoadingContents) {
   startLoading(contents);
   contents.loading = false;
   contents.emit("did-stop-loading");
}

/**
 * A load is stopped after its navigation committed, such as `webContents.stop()` while the new
 * document loads: `did-navigate`, then `did-fail-load` with ERR_ABORTED (-3), which shows no
 * error page, and `did-stop-loading` without a `did-finish-load`.
 */
export function stopCommittedLoad(contents: LoadingContents) {
   commitNavigation(contents);
   contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "app://x", true);
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
      MessageChannelMain: vi.fn(),
      utilityProcess: { fork: vi.fn() },
   };
}

/**
 * What `contextBridge` hands the page: a copy of the objects and arrays, made when the API is
 * exposed, so that a later change of the original does not reach the page. The functions are the
 * same ones, as the proxies of Electron call the originals.
 */
function bridgeCopy(value: unknown): unknown {
   if (Array.isArray(value)) {
      return value.map(bridgeCopy);
   }
   if (value === null || typeof value !== "object") {
      return value;
   }
   const copy: Record<string, unknown> = Object.create(Object.getPrototypeOf(value));
   for (const [key, member] of Object.entries(value)) {
      copy[key] = bridgeCopy(member);
   }
   return copy;
}

/** Throws as `contextBridge` does when the key of the world is taken already. */
function exposeOnce(world: Record<string, unknown>, key: string, api: unknown): void {
   if (Object.hasOwn(world, key)) {
      throw new Error("Cannot bind an API on top of an existing property on the window object");
   }
   world[key] = bridgeCopy(api);
}

/** A fake `electron` module for the generated preload script, which records what it exposes. */
export function createFakePreloadElectron() {
   const exposed: Record<string, any> = {};
   const exposedInWorld: Record<number, Record<string, any>> = {};
   return {
      exposed,
      exposedInWorld,
      electron: {
         contextBridge: {
            exposeInMainWorld: vi.fn((key: string, api: unknown) => exposeOnce(exposed, key, api)),
            exposeInIsolatedWorld: vi.fn((worldId: number, key: string, api: unknown) => {
               exposedInWorld[worldId] ??= {};
               exposeOnce(exposedInWorld[worldId], key, api);
            }),
         },
         ipcRenderer: {
            invoke: vi.fn(),
            send: vi.fn(),
            on: vi.fn(),
            once: vi.fn(),
            removeListener: vi.fn(),
         },
         webUtils: {
            getPathForFile: vi.fn((file: { path?: string }) => file.path ?? ""),
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
      .sort(byCodeUnit);
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
   return (find(module) ?? []).sort(byCodeUnit);
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
      return: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
   };
   return {
      iterable: { [Symbol.asyncIterator]: () => iterator },
      iterator,
      push: (value: unknown) => feed({ result: { done: false, value } }),
      end: () => feed({ result: { done: true, value: undefined } }),
      fail: (error: unknown) => feed({ error }),
   };
}
