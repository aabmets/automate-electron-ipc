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

import { createFakeElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { vi } from "vitest";
import { fixtures } from "../fixture-tracker.js";
import { resetUtilityProcessFakes, setAttachChild } from "./fake-utility.js";

export async function load(fixture = "utility-channels") {
   const project = await fixtures.run(fixture);
   const main = loadGenerated(project.generated["main.ts"], { electron: createFakeElectron() });
   setAttachChild(main.attachUtility);
   const utilitySource = project.generated["utility.ts"];
   const utility = utilitySource ? loadGenerated(utilitySource, {}) : undefined;
   return { main, utility };
}

/** Undoes what `load`, `createChild` and `createParentPort` set up. Call it from `afterEach`. */
export function resetUtilityFakes() {
   resetUtilityProcessFakes();
   vi.restoreAllMocks();
}
