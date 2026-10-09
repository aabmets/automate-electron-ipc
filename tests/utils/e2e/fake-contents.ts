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
import { vi } from "vitest";

export interface FakeContentsOptions {
   /** The `id` of the contents. Defaults to 1. */
   id?: number;
   /** Whether `isLoading()` is true. Defaults to false, a page that has loaded. */
   loading?: boolean;
   /** The result of `getURL()`. Defaults to `app://.`. */
   url?: string;
   /** Whether the contents are destroyed from the start. */
   destroyed?: boolean;
   /** Whether the renderer process of the contents has crashed. */
   crashed?: boolean;
}

/**
 * A `WebContents` stand-in: an emitter that records what is sent to it (`send`, `postMessage`).
 * Like the real one, it throws "Object has been destroyed" when something is sent after
 * `destroyed` was set, and `destroy()` sets it and emits `destroyed`, which is how Electron
 * announces that the contents cannot be used any more. `loading`, `url`, `destroyed` and
 * `crashed` can be changed by a test, and `isLoading()`, `getURL()`, `isDestroyed()` and
 * `isCrashed()` report them.
 */
export function createContents(options: FakeContentsOptions = {}) {
   const refuseWhenDestroyed = () => {
      if (contents.destroyed) {
         throw new Error("Object has been destroyed");
      }
   };
   const contents = Object.assign(new EventEmitter(), {
      id: options.id ?? 1,
      loading: options.loading ?? false,
      url: options.url ?? "app://.",
      destroyed: options.destroyed ?? false,
      crashed: options.crashed ?? false,
      postMessage: vi.fn((..._args: any[]) => refuseWhenDestroyed()),
      send: vi.fn((..._args: any[]) => refuseWhenDestroyed()),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => contents.destroyed,
      isCrashed: () => contents.crashed,
      destroy() {
         contents.destroyed = true;
         contents.emit("destroyed");
      },
   });
   return contents;
}

export type FakeContents = ReturnType<typeof createContents>;
