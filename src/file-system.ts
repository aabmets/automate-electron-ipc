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

import fsp from "node:fs/promises";
import path from "node:path";

/** Swaps the case of every letter, so that `Src` becomes `sRC`. */
function swapCase(text: string): string {
   return Array.from(text, (char) =>
      char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase(),
   ).join("");
}

/**
 * Tells whether the file system that holds `directory` ignores case, so that `ipc/Main.ts` and
 * `ipc/main.ts` are one file. It looks up the same directory by a name with swapped case and checks
 * whether that finds the directory itself, so it writes nothing. The nearest existing ancestor
 * stands in for a directory that does not exist yet. Defaults to `false` when no part of the path
 * has a letter to swap.
 *
 * @param directory - A directory of the project, which need not exist.
 * @returns True if the file system ignores case.
 */
export async function isCaseInsensitiveFileSystem(directory: string): Promise<boolean> {
   const current = path.resolve(directory);
   const name = path.basename(current);
   const swapped = swapCase(name);
   if (swapped !== name) {
      const original = await fsp.stat(current, { bigint: true }).catch(() => null);
      if (original !== null) {
         const other = await fsp
            .stat(path.join(path.dirname(current), swapped), { bigint: true })
            .catch(() => null);
         return other !== null && other.ino === original.ino && other.dev === original.dev;
      }
   }
   const parent = path.dirname(current);
   return parent === current ? false : await isCaseInsensitiveFileSystem(parent);
}
