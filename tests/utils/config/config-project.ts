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
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * A real project directory for each test: a `package.json` and the given files, in a temp dir that
 * is removed after the test. `manifest` is the content of the `package.json`, and `files` maps
 * paths in the project to their text.
 */
export function withConfigProject() {
   let dir = "";
   beforeEach(async () => {
      dir = await fsp.realpath(await fsp.mkdtemp(path.join(tmpdir(), "vitest-config-")));
   });
   afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
   });
   return {
      get dir() {
         return dir;
      },
      /** The directory of the project with `/` separators, as `projectRoot` spells it. */
      get root() {
         return dir.replaceAll("\\", "/");
      },
      async write(files: Record<string, string>, manifest: object = { name: "project" }) {
         const all = { "package.json": JSON.stringify(manifest), ...files };
         await Promise.all(
            Object.entries(all).map(async ([name, text]) => {
               await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
               await fsp.writeFile(path.join(dir, name), text);
            }),
         );
      },
      /** The names of the entries of a directory of the project, sorted. */
      async list(sub = "."): Promise<string[]> {
         return (await fsp.readdir(path.join(dir, sub))).sort();
      },
   };
}
