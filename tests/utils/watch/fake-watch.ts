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
import fs from "node:fs";

type Listener = (event: string, name: string | null) => void;

/** What `fs.watch` gives back: an emitter of `error` with a `close`, plus the call that made it. */
export class FakeWatcher extends EventEmitter {
   closed = false;
   readonly dir: string;
   readonly recursive: boolean;
   private readonly listener: Listener;

   constructor(dir: string, recursive: boolean, listener: Listener) {
      super();
      this.dir = dir;
      this.recursive = recursive;
      this.listener = listener;
   }

   close(): void {
      this.closed = true;
   }

   /** Reports a change of the file `name`, which is relative to the watched directory. */
   change(name: string | null): void {
      this.listener("change", name);
   }
}

/**
 * A replacement for `fs.watch` that records its watchers. Like the real one, it throws `ENOENT`
 * for a directory that does not exist.
 */
export function createFakeWatch() {
   const watchers: FakeWatcher[] = [];
   const watch = ((dir: string, options: { recursive?: boolean }, listener: Listener) => {
      if (!fs.existsSync(dir)) {
         throw Object.assign(new Error(`ENOENT: no such directory, watch '${dir}'`), {
            code: "ENOENT",
         });
      }
      const watcher = new FakeWatcher(dir, options.recursive ?? false, listener);
      watchers.push(watcher);
      return watcher;
   }) as unknown as typeof fs.watch;
   return {
      watch,
      /** Every watcher that was made, closed or not. */
      watchers,
      /** The watchers that are open, by directory. */
      open: (): Map<string, FakeWatcher> =>
         new Map(watchers.filter((w) => !w.closed).map((w) => [w.dir, w])),
   };
}

/** Collects the reports of `onRun`, and waits for a number of runs without sleeping. */
export function createRunTracker() {
   const errors: unknown[] = [];
   const waiters: { count: number; resolve: () => void }[] = [];
   return {
      errors,
      onRun(error: unknown): void {
         errors.push(error);
         for (const waiter of waiters.filter((w) => w.count <= errors.length)) {
            waiter.resolve();
         }
      },
      /** Resolves once the watcher has reported `count` runs in total. */
      until(count: number): Promise<void> {
         return new Promise((resolve) => {
            if (errors.length >= count) {
               resolve();
            } else {
               waiters.push({ count, resolve });
            }
         });
      },
   };
}
