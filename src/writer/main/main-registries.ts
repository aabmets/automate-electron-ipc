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

import type * as t from "@types";
import { anySpec } from "../channel-kinds.js";

/**
 * Whether a call from a renderer is checked against a scope: the channels that a page calls in
 * the main process (`invoke`, `send` and `stream`) with `scopes`.
 */
export function hasScopedGuards(pfsArray: t.ParsedFileSpecs[]): boolean {
   return anySpec(
      pfsArray,
      (spec) => spec.direction === "RendererToMain" && spec.scopes !== undefined,
   );
}

/**
 * The registry of the scopes of the windows: `IpcScope`, the names that the schema declares, and
 * `registerScope(target, scope)`, which puts the contents of a window, a view or contents into a
 * scope. A channel with `scopes` is open only to the contents that are registered in one of its
 * scopes, and contents that are in no scope can use only the channels without `scopes`. The
 * registry holds the ID of the contents, so it keeps no reference to them. An entry is removed
 * by its disposer and when the contents are destroyed, and registering the contents again
 * replaces the entry: the disposer of the replaced one does nothing. A scope that the schema
 * does not declare is a mistake which would otherwise lock the window out without a word, so
 * it throws.
 */
export function buildScopeRegistry(indents: string[], scopes: string[]): string {
   const [i1, i2, i3] = indents;
   const names = scopes.map((scope) => `'${scope}'`);
   return [
      "",
      `export type IpcScope = ${names.join(" | ")};`,
      "",
      `const ipcScopeNames: readonly string[] = [${names.join(", ")}];`,
      "",
      "interface ScopeEntry {",
      `${i1}scope: IpcScope;`,
      `${i1}remove: () => void;`,
      "}",
      "",
      "const scopeRegistry: { [id: string]: ScopeEntry | undefined } = { __proto__: null } as any;",
      "",
      "export function registerScope(",
      `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
      `${i1}scope: IpcScope,`,
      "): () => void {",
      `${i1}if (!ipcScopeNames.includes(scope)) {`,
      `${i2}throw new TypeError(\`The scope '\${scope}' is not declared in the schema. Use one of: \${ipcScopeNames.join(', ')}\`);`,
      `${i1}}`,
      `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
      `${i1}if (contents.isDestroyed()) {`,
      `${i2}throw new TypeError('Object has been destroyed');`,
      `${i1}}`,
      `${i1}const id = contents.id;`,
      `${i1}scopeRegistry[id]?.remove();`,
      `${i1}const remove = () => {`,
      `${i2}if (scopeRegistry[id] === entry) {`,
      `${i3}delete scopeRegistry[id];`,
      `${i2}}`,
      `${i2}if (!contents.isDestroyed()) {`,
      `${i3}contents.removeListener('destroyed', remove);`,
      `${i2}}`,
      `${i1}};`,
      `${i1}const entry: ScopeEntry = { scope, remove };`,
      `${i1}scopeRegistry[id] = entry;`,
      `${i1}contents.once('destroyed', remove);`,
      `${i1}return remove;`,
      "}",
      "",
   ].join("\n");
}

/**
 * Where a listener or handler is registered: `resolveIpcTarget` returns the global `ipcMain`, or
 * with `options.webContents` the `ipc` of those contents, which Electron dispatches to before
 * `ipcMain` and which only gets the messages of that page. It also gives the registry of the
 * handlers that the target has now, which a disposer compares against (it uses no global, which
 * a schema type could shadow, and has no prototype), and `watch`, which disposes the
 * registration when the contents are destroyed. The registry of the contents and the single
 * `destroyed` listener are made once per contents, so any number of channels does not hit the
 * limit of listeners, and both are dropped when the contents are destroyed. A handler replaces
 * the one of its channel, and the registration it replaces is released at once, so registering
 * again for each load does not accumulate the callbacks that were replaced. Contents which are
 * already destroyed throw, since `ipc` would never receive anything.
 */
export function buildTargetResolver(indents: string[]): string {
   const [i1, i2, i3, i4] = indents;
   return [
      "",
      "export interface IpcListenOptions {",
      `${i1}/**`,
      `${i1} * Registers on the \`ipc\` of these contents instead of the global \`ipcMain\`: only the`,
      `${i1} * messages of this page arrive, an \`invoke\` handler wins over the global one, and the`,
      `${i1} * registration is removed when the contents are destroyed.`,
      `${i1} */`,
      `${i1}webContents?: WebContents;`,
      "}",
      "",
      "interface IpcTarget {",
      `${i1}ipc: IpcMain;`,
      `${i1}handlers: { [channel: string]: unknown };`,
      `${i1}watch: (remove: () => void, handled?: string) => () => void;`,
      "}",
      "",
      "interface IpcContentsRecord {",
      `${i1}handlers: { [channel: string]: unknown };`,
      `${i1}removers: (() => void)[];`,
      `${i1}/** The remover of the registration which holds the handler of each channel now. */`,
      `${i1}current: { [channel: string]: unknown };`,
      "}",
      "",
      "const registeredHandlers: { [channel: string]: unknown } = { __proto__: null };",
      "",
      "const contentsIpcRegistry: { [id: string]: unknown } = { __proto__: null };",
      "",
      "function resolveIpcTarget(options?: IpcListenOptions): IpcTarget {",
      `${i1}const contents = options?.webContents;`,
      `${i1}if (!contents) {`,
      `${i2}return { ipc: electronIpcMain, handlers: registeredHandlers, watch: () => () => {} };`,
      `${i1}}`,
      `${i1}if (contents.isDestroyed()) {`,
      `${i2}throw new TypeError('Object has been destroyed');`,
      `${i1}}`,
      `${i1}const id = contents.id;`,
      `${i1}let record = contentsIpcRegistry[id] as IpcContentsRecord | undefined;`,
      `${i1}if (!record) {`,
      `${i2}const created: IpcContentsRecord = { handlers: { __proto__: null }, removers: [], current: { __proto__: null } };`,
      `${i2}record = created;`,
      `${i2}contentsIpcRegistry[id] = created;`,
      `${i2}contents.once('destroyed', () => {`,
      `${i3}delete contentsIpcRegistry[id];`,
      `${i3}for (const remove of created.removers.slice()) {`,
      `${i4}remove();`,
      `${i3}}`,
      `${i2}});`,
      `${i1}}`,
      `${i1}const { handlers, removers, current } = record;`,
      `${i1}const forget = (remove: () => void): void => {`,
      `${i2}for (let at = 0; at < removers.length; at++) {`,
      `${i3}if (removers[at] === remove) {`,
      `${i3}${i1}removers.splice(at, 1);`,
      `${i3}${i1}return;`,
      `${i3}}`,
      `${i2}}`,
      `${i1}};`,
      `${i1}return {`,
      `${i2}ipc: contents.ipc,`,
      `${i2}handlers,`,
      `${i2}watch: (remove, handled) => {`,
      `${i3}// A handler replaces the one of its channel, so the registration it replaced is released:`,
      `${i3}// its remover would otherwise hold the replaced callback until the contents are destroyed.`,
      `${i3}if (handled !== undefined) {`,
      `${i4}const replaced = current[handled] as (() => void) | undefined;`,
      `${i4}if (replaced) {`,
      `${i4}${i1}forget(replaced);`,
      `${i4}}`,
      `${i4}current[handled] = remove;`,
      `${i3}}`,
      `${i3}removers.push(remove);`,
      `${i3}return () => {`,
      `${i4}forget(remove);`,
      `${i4}if (handled !== undefined && current[handled] === remove) {`,
      `${i4}${i1}delete current[handled];`,
      `${i4}}`,
      `${i3}};`,
      `${i2}},`,
      `${i1}};`,
      "}",
      "",
   ].join("\n");
}
