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

import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("a config file in the project root", () => {
   it("configures the run, and the generated files type-check", async () => {
      const project = await fixtures.run("config-file-ts", { ipcDataDir: "ipc" });

      expect(project.generated["main.ts"]).toContain("getUser");
      // The config sets codeIndent 2, so the generated code is indented with two spaces.
      expect(project.generated["main.ts"]).toMatch(/\n {2}\S/);
      expect(project.generated["main.ts"]).not.toMatch(/\n {3}[^\s*]/);
      expect(await project.typecheck()).toBe("");
   });
});
