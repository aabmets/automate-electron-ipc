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

import { existsSync } from "node:fs";
import path from "node:path";
import cfg from "@src/config.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import { afterAll, describe, expect, it, vi } from "vitest";

describe("withAutomationDir", () => {
   const automation = withAutomationDir("vitest-automation-utils-");
   const made: string[] = [];

   it("gives each test a directory of its own that exists", () => {
      made.push(automation.dir);

      expect(path.basename(automation.dir)).toMatch(/^vitest-automation-utils-/);
      expect(existsSync(automation.dir)).toBe(true);
   });

   it("makes another directory for the next test", () => {
      made.push(automation.dir);

      expect(existsSync(automation.dir)).toBe(true);
      expect(new Set(made).size).toBe(made.length);
   });

   it("resolves a config whose generated files go to the out directory of the test", async () => {
      automation.mockConfig({ codeIndent: 4 });

      const config = await cfg.getResolvedConfig();

      expect(config.codeIndent).toBe(4);
      expect(config.mainBindingsFilePath).toBe(path.join(automation.dir, "out/main.ts"));
      expect(config.serviceWorkerTypesFilePath).toBe(
         path.join(automation.dir, "out/service-worker.d.ts"),
      );
   });

   it("restores what a test spied on", () => {
      vi.spyOn(cfg, "getResolvedConfig").mockResolvedValue({ codeIndent: 9 } as never);
      made.push(automation.dir);
   });

   // Its own hooks removed the directories and the mocks when the tests above were done.
   afterAll(() => {
      const left = made.filter((dir) => existsSync(dir));
      if (left.length > 0) {
         throw new Error(`The directories ${left.join(", ")} were not removed`);
      }
      if (vi.isMockFunction(cfg.getResolvedConfig)) {
         throw new Error("getResolvedConfig was not restored");
      }
   });
});
