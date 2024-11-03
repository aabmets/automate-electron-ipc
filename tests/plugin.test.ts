/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import { ipcAutomation } from "@plugin";
import * as validator from "@validator";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   it("should call validator and throw error on empty options array", () => {
      const spy = vi.spyOn(validator, "validateOptions");
      expect(() => ipcAutomation([])).toThrow("Please read the documentation");
      expect(spy).toHaveBeenCalledOnce();
   });
});
