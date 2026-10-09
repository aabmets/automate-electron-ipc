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
