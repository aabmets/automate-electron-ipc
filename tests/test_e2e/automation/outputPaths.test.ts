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
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

const MAIN = "src/main/generated/ipc-main.ts";
const PRELOAD = "src/preload/generated/deep/ipc-preload.ts";
const TYPES = "types/ipc-window.d.ts";
/** The options of the fixture, which moves all three files. */
const MOVED = { mainBindingsPath: MAIN, preloadBindingsPath: PRELOAD, rendererTypesPath: TYPES };

/** Whether the file exists; `fsp.access` resolves to undefined under Node but to null under Bun. */
const exists = (file: string): Promise<boolean> =>
   fsp.access(file).then(
      () => true,
      () => false,
   );

describe("the paths of the generated files of the page", () => {
   it("are set by the config, each in a directory of its own, and the files type-check", async () => {
      const project = await fixtures.run("output-paths");

      await Promise.all(
         [MAIN, PRELOAD, TYPES].map((file) =>
            expect(exists(path.join(project.dir, file))).resolves.toBe(true),
         ),
      );
      // The data directory holds the schema, its imports and types.ts, which no option moves.
      await expect(exists(path.join(project.dir, "src/ipc/main.ts"))).resolves.toBe(false);
      // The files that import the types of the schema reach them from their own directory.
      expect(project.generated["main.ts"]).toContain('"../../ipc/models"');
      expect(project.generated["main.ts"]).toContain('"../../shared/shapes"');
      expect(project.generated["types.ts"]).toContain('"./models"');
      // The typings reach the types module from their own directory.
      expect(project.generated["window.d.ts"]).toContain('"../src/ipc/types"');
      expect(await project.typecheck()).toBe("");
   });

   it.each([
      ["main.ts", { mainBindingsPath: MAIN }],
      ["preload.ts", { preloadBindingsPath: PRELOAD }],
      ["window.d.ts", { rendererTypesPath: TYPES }],
   ])("type-check with only %s moved to another directory", async (name, moved) => {
      const project = await fixtures.run("output-paths", {
         config: { ...Object.fromEntries(Object.keys(MOVED).map((k) => [k, undefined])), ...moved },
      });

      const [file] = Object.values(moved);
      await expect(exists(path.join(project.dir, file))).resolves.toBe(true);
      await Promise.all(
         ["main.ts", "preload.ts", "window.d.ts"]
            .filter((other) => other !== name)
            .map((other) =>
               expect(exists(path.join(project.dir, "src/ipc", other))).resolves.toBe(true),
            ),
      );
      expect(await project.typecheck()).toBe("");
   });
});
