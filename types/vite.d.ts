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

import type { GenerateOptions } from "./api.js";

export type { GenerateOptions };

/**
 * The part of a Vite plugin that `autoipc` implements. It is declared here so that the package does
 * not depend on `vite`, and it is assignable to Vite's own `Plugin`.
 */
export interface VitePluginLike {
   name: string;
   /** Generates the bindings when a build, or the dev server, starts. */
   buildStart?: () => Promise<void>;
   /** Watches the schema directory and the files of the config. */
   configureServer?: (server: {
      watcher: { add: (paths: string | string[]) => unknown };
   }) => void | Promise<void>;
   /** Regenerates when a schema or config file changes. Resolves `[]` for schema files. */
   handleHotUpdate?: (context: { file: string }) => Promise<[] | undefined>;
}

/**
 * Generates the IPC bindings when a build starts, and again when the schema or the config changes
 * in the dev server. Add it to the `plugins` of each config of Vite or electron-vite.
 */
export function autoipc(options?: GenerateOptions): VitePluginLike;
