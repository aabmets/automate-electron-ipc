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

/** The watches of the generated `main.ts` on the events of contents, windows and children. */

/**
 * `watchEvent(emitter, event, callback)`, which the calls and connections that the main process
 * holds open use to learn when the contents, the window or the child they depend on goes away.
 * A listener of its own for each of them would grow without bound while they are open, and
 * Node warns about more than ten of the same event (`MaxListenersExceededWarning`). So an
 * emitter has one listener for each event, with the callbacks of all watchers behind it, which
 * is added with the first watcher and removed with the last. The disposer removes that one
 * callback, and a callback which was removed is not called by a dispatch that is under way. A
 * callback which throws is logged and does not keep the others from running. The callbacks
 * are held by a `WeakMap` that is keyed by the emitter, so nothing outlives the contents.
 */
export function buildEventWatch(indents: string[]): string {
   const [i1, i2, i3, i4, i5] = indents;
   return [
      "",
      "interface WatchableEmitter {",
      `${i1}on(event: string, listener: (...args: any[]) => void): unknown;`,
      `${i1}removeListener(event: string, listener: (...args: any[]) => void): unknown;`,
      "}",
      "",
      "interface EventWatch {",
      `${i1}callbacks: ((...args: any[]) => void)[];`,
      `${i1}listener: (...args: any[]) => void;`,
      "}",
      "",
      "const eventWatches = new WeakMap<object, { [event: string]: EventWatch | undefined }>();",
      "",
      "function watchEvent(",
      `${i1}emitter: WatchableEmitter,`,
      `${i1}event: string,`,
      `${i1}callback: (...args: any[]) => void,`,
      "): () => void {",
      `${i1}const known = eventWatches.get(emitter);`,
      `${i1}const watched: { [event: string]: EventWatch | undefined } = known ?? ({ __proto__: null } as any);`,
      `${i1}if (!known) {`,
      `${i2}eventWatches.set(emitter, watched);`,
      `${i1}}`,
      `${i1}let watch = watched[event];`,
      `${i1}if (!watch) {`,
      `${i2}const callbacks: ((...args: any[]) => void)[] = [];`,
      `${i2}watch = {`,
      `${i3}callbacks,`,
      `${i3}listener: (...args: any[]) => {`,
      `${i4}for (const next of callbacks.slice()) {`,
      `${i5}if (callbacks.indexOf(next) >= 0) {`,
      `${i5}${i1}try {`,
      `${i5}${i2}next(...args);`,
      `${i5}${i1}} catch (error) {`,
      `${i5}${i2}console.error(error);`,
      `${i5}${i1}}`,
      `${i5}}`,
      `${i4}}`,
      `${i3}},`,
      `${i2}};`,
      `${i2}watched[event] = watch;`,
      `${i2}emitter.on(event, watch.listener);`,
      `${i1}}`,
      `${i1}const { callbacks, listener } = watch;`,
      `${i1}callbacks.push(callback);`,
      `${i1}return () => {`,
      `${i2}const at = callbacks.indexOf(callback);`,
      `${i2}if (at < 0) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}callbacks.splice(at, 1);`,
      `${i2}if (callbacks.length === 0 && watched[event] === watch) {`,
      `${i3}delete watched[event];`,
      `${i3}try {`,
      `${i4}emitter.removeListener(event, listener);`,
      `${i3}} catch {`,
      `${i4}// Destroyed contents have dropped their listeners, and cannot be reached.`,
      `${i3}}`,
      `${i2}}`,
      `${i1}};`,
      "}",
      "",
   ].join("\n");
}

/**
 * `watchPageLoad` tells when the page of some contents has loaded, which a port has to wait for,
 * since one that is posted earlier arrives before the preload script listens for it. It cannot
 * ask `isLoading()`: Electron keeps it `true` while `did-finish-load` fires, and after
 * `loadURL` has resolved, until `did-stop-loading`. So the page counts as loaded from every
 * `did-finish-load`, and from the `did-stop-loading` of a load that `did-finish-load` has not
 * reported, such as one that finished before the watch began. A failed main-frame load does not
 * count, nor does the error page that Electron shows for it. The exception is ERR_ABORTED (-3)
 * after a commit, such as `stop()` while the new document loads: it shows no error page and the
 * document that committed is there, so the `did-stop-loading` that follows counts as its load.
 * The state of the load resets only when a main-frame navigation commits (`did-navigate`), so
 * one that never commits changes nothing. The events are watched through `watchEvent`, so any number of watches of the same
 * contents adds one listener of each event. `onLoad` runs once per load, and the watch starts
 * out loaded if the contents have a page and are not loading.
 */
export function buildPageLoadWatch(indents: string[]): string {
   const [i1, i2, i3, i4] = indents;
   return [
      "",
      "interface PageLoadWatch {",
      `${i1}isLoaded: () => boolean;`,
      `${i1}dispose: () => void;`,
      "}",
      "",
      "function watchPageLoad(contents: WebContents, onLoad: () => void): PageLoadWatch {",
      `${i1}let loaded = !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== '';`,
      `${i1}// Whether the load that is going on has been reported already.`,
      `${i1}let settled = !contents.isDestroyed() && !contents.isLoading();`,
      `${i1}let failed = false;`,
      `${i1}// Whether a main-frame navigation has committed since the watch began.`,
      `${i1}let committed = false;`,
      `${i1}// A main-frame navigation that commits replaces the document. One that starts and stops`,
      `${i1}// without a commit (a prevented one, a download, a 204 response) leaves the page as it was.`,
      `${i1}const commit = () => {`,
      `${i2}loaded = false;`,
      `${i2}settled = false;`,
      `${i2}failed = false;`,
      `${i2}committed = true;`,
      `${i1}};`,
      `${i1}// A failed load ends in the error page of Electron, which fires its own did-finish-load.`,
      `${i1}// ERR_ABORTED (-3) shows no error page, so the page that was loaded stays loaded. When it`,
      `${i1}// follows a commit, the document that committed is the page, and it loaded as far as it got.`,
      `${i1}const fail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {`,
      `${i2}if (!isMainFrame) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}if (code !== -3) {`,
      `${i3}failed = true;`,
      `${i3}loaded = false;`,
      `${i2}} else if (!committed) {`,
      `${i3}failed = true;`,
      `${i2}}`,
      `${i1}};`,
      `${i1}const finish = () => {`,
      `${i2}if (failed) {`,
      `${i3}return;`,
      `${i2}}`,
      `${i2}loaded = true;`,
      `${i2}settled = true;`,
      `${i2}onLoad();`,
      `${i1}};`,
      `${i1}const stop = () => {`,
      `${i2}if (!settled && !failed) {`,
      `${i3}finish();`,
      `${i2}}`,
      `${i1}};`,
      `${i1}const stops = [`,
      `${i2}watchEvent(contents, 'did-navigate', commit),`,
      `${i2}watchEvent(contents, 'did-fail-load', fail),`,
      `${i2}watchEvent(contents, 'did-finish-load', finish),`,
      `${i2}watchEvent(contents, 'did-stop-loading', stop),`,
      `${i1}];`,
      `${i1}return {`,
      `${i2}isLoaded: () => loaded,`,
      `${i2}dispose: () => {`,
      `${i3}for (const unwatch of stops) {`,
      `${i4}unwatch();`,
      `${i3}}`,
      `${i2}},`,
      `${i1}};`,
      "}",
      "",
   ].join("\n");
}
