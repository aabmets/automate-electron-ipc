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

import utils from "@src/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

describe("compareStrings", () => {
   it("returns zero for equal strings and a sign for different ones", () => {
      expect(utils.compareStrings("a", "a")).toBe(0);
      expect(utils.compareStrings("a", "b")).toBeLessThan(0);
      expect(utils.compareStrings("b", "a")).toBeGreaterThan(0);
   });

   it("compares by code units: upper case, underscore, lower case, then non-ASCII", () => {
      const sorted = ["ä", "b", "_", "B", "a", "A", "2", "10"].sort(utils.compareStrings);
      expect(sorted).toStrictEqual(["10", "2", "A", "B", "_", "a", "b", "ä"]);
   });

   it("does not use the locale of the process", () => {
      const spy = vi.spyOn(String.prototype, "localeCompare");
      try {
         ["ä", "z", "a"].sort(utils.compareStrings);
         expect(spy).not.toHaveBeenCalled();
      } finally {
         spy.mockRestore();
      }
   });
});
