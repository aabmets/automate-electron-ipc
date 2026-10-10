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

import { afterAll, afterEach } from "vitest";
import { type E2EProject, type RunFixtureOptions, runFixture } from "./e2e-utils.js";

/** Runs fixtures, and keeps every project it ran until `cleanup` removes it. */
export function createFixtureTracker() {
   const projects: E2EProject[] = [];
   return {
      /** Runs the fixture, like `runFixture`, and tracks the project for `cleanup`. */
      async run(name: string, options?: RunFixtureOptions): Promise<E2EProject> {
         const project = await runFixture(name, options);
         projects.push(project);
         return project;
      },
      /** The project that was run last and not cleaned up yet, for a test which reads its files. */
      current: (): E2EProject | undefined => projects.at(-1),
      async cleanup(): Promise<void> {
         await Promise.all(projects.splice(0).map((project) => project.cleanup()));
      },
   };
}

/**
 * A tracker which removes its projects with a hook of its own, so the temp dirs go away after a
 * failing test too, and the test needs no state or hook for it. It must be created at the top of
 * a module. The hook is `afterEach` for the projects of single tests, and `afterAll` with
 * `"file"`, for a project that a `beforeAll` runs once and the tests of the file share.
 */
export function trackFixtures(scope: "test" | "file" = "test") {
   const tracker = createFixtureTracker();
   (scope === "file" ? afterAll : afterEach)(tracker.cleanup);
   return { run: tracker.run, current: tracker.current };
}

/**
 * The tracker for the projects of single tests, which a test file and the helpers it imports
 * share, so that `current` finds the project that any of them ran. Importing this module registers
 * its `afterEach`, so `fixtures.run(name)` is all a test needs to run a fixture.
 */
export const fixtures = trackFixtures();
