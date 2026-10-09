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

import { vi } from "vitest";
import type { E2EProject } from "../e2e-utils.js";
import { createFakeElectron, loadGenerated } from "./runtime-utils.js";

export type Check = (args: unknown[]) => string | null;

/** A Standard Schema of an argument tuple, whose answer the test can hold back. */
export function schema(check: Check, held = false) {
   const waiting: (() => void)[] = [];
   const validate = vi.fn((value: unknown) => {
      const message = Array.isArray(value) ? check(value) : "not an array";
      const result = message === null ? { value } : { issues: [{ message }] };
      return held ? new Promise((resolve) => waiting.push(() => resolve(result))) : result;
   });
   return {
      "~standard": { version: 1, vendor: "test", validate },
      validate,
      /** Answers the validations that are held back. */
      release: () => {
         for (const answer of waiting.splice(0)) {
            answer();
         }
      },
   };
}

export const oneString: Check = (args) =>
   args.length === 1 && typeof args[0] === "string" ? null : "expected one string";
export const oneNumber: Check = (args) =>
   args.length === 1 && typeof args[0] === "number" ? null : "expected one number";

/** Runs the generated `main.ts` of the guards fixture, with the given module for `./validators`. */
export function loadGuardMain(project: E2EProject, validators: Record<string, unknown>): any {
   return loadGenerated(project.generated["main.ts"], {
      electron: createFakeElectron(),
      "./validators": validators,
   });
}
