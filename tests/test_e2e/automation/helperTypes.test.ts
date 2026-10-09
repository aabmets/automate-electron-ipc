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

describe("helper types, fixture helper-types", () => {
   it("writes types.ts next to the other files, with the map of each schema file", async () => {
      const { generated } = await fixtures.run("helper-types");

      expect(generated["types.ts"]).toContain(
         'import type { channels as ChannelMap } from "./schema/legacy";',
      );
      expect(generated["types.ts"]).toContain('import type ChannelMap_2 from "./schema/main";');
      expect(generated["types.ts"]).toContain(
         "type ChannelMaps = typeof ChannelMap & typeof ChannelMap_2;",
      );
      expect(generated["window.d.ts"]).toContain('import type { IpcApi } from "./types";');
      expect(generated["window.d.ts"]).not.toContain("interface IpcApi");
   });

   it("types the names, the arguments and the results of every kind of channel", async () => {
      const project = await fixtures.run("helper-types");

      expect(await project.typecheck()).toBe("");
   }, 60_000);

   // The checks of the fixture must be able to fail: a wrong type is reported with its file.
   it("reports a helper type that does not match the signature", async () => {
      const project = await fixtures.run("helper-types");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "schema-wrong.ts"),
         [
            'import type { ChannelReturn } from "./types";',
            "type Equal<A, B> =",
            "   (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;",
            'export const wrong: Equal<ChannelReturn<"getUser">, string> = true;',
         ].join("\n"),
      );

      const diagnostics = await project.typecheck();

      expect(diagnostics).toContain("schema-wrong.ts");
      expect(diagnostics).not.toContain("schema-types.ts");
   }, 60_000);

   it("lets a file of the main process use types.ts without the global of the page", async () => {
      const project = await fixtures.run("helper-types");

      // The unused `@ts-expect-error` of the file is an error if `window.ipc` is declared.
      const files = [`${project.ipcDataDir}/main-usage.ts`];
      expect(await project.typecheckFiles(files)).toBe("");
      // With window.d.ts in the compilation, the directive has nothing to expect.
      await fsp.copyFile(
         path.join(project.dir, project.ipcDataDir, "window.d.ts"),
         path.join(project.dir, project.ipcDataDir, "window.dts-check.ts"),
      );
      expect(
         await project.typecheckFiles([...files, `${project.ipcDataDir}/window.dts-check.ts`]),
      ).toContain("Unused '@ts-expect-error' directive");
   }, 60_000);
});
