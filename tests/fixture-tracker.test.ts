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
import { createFixtureTracker, trackFixtures } from "@testutils/fixture-tracker.js";
import { afterAll, describe, expect, it } from "vitest";

describe("createFixtureTracker", () => {
   it("tracks the projects it runs, and removes the temp dir of each in cleanup", async () => {
      const tracker = createFixtureTracker();
      expect(tracker.current()).toBeUndefined();

      const first = await tracker.run("all-kinds");
      const second = await tracker.run("all-kinds");
      expect(tracker.current()).toBe(second);
      expect(first.root).not.toBe(second.root);
      expect(existsSync(first.root) && existsSync(second.root)).toBe(true);

      await tracker.cleanup();

      expect(existsSync(first.root) || existsSync(second.root)).toBe(false);
      expect(tracker.current()).toBeUndefined();
   });

   it("passes the options on to runFixture", async () => {
      const tracker = createFixtureTracker();
      const project = await tracker.run("workspace", { project: "packages/app" });
      try {
         expect(project.dir.endsWith("packages/app")).toBe(true);
      } finally {
         await tracker.cleanup();
      }
   });

   it("cleans up when cleanup has nothing to remove", async () => {
      await expect(createFixtureTracker().cleanup()).resolves.toBeUndefined();
   });
});

describe("trackFixtures", () => {
   const fixtures = trackFixtures();
   let root: string | undefined;

   it("runs a fixture", async () => {
      const project = await fixtures.run("all-kinds");
      root = project.root;
      expect(fixtures.current()).toBe(project);
      expect(existsSync(project.root)).toBe(true);
   });

   // Its own afterEach removed the project when the test above finished, even if that test failed.
   afterAll(() => {
      if (root !== undefined && existsSync(root)) {
         throw new Error(`The project in ${root} was not removed after the test`);
      }
   });
});
