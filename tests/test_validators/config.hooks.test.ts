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

import { validateOptionalConfig } from "@src/validation/config-validation.js";
import { baseConfig } from "@testutils/validator-utils.js";
import { describe, expect, it } from "vitest";

describe("validateOptionalConfig, hooks", () => {
   const check = (hooks: unknown) =>
      validateOptionalConfig({ ...baseConfig, hooks: hooks as "react" });

   it.each(["react", "vue", false])("accepts %j", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it("accepts a config without the option", () => {
      expect(() => validateOptionalConfig(baseConfig)).not.toThrowError();
   });

   it.each(["svelte", "React", true, 0, null, []])("rejects %j", (value) => {
      expect(() => check(value)).toThrowError(/hooks must be 'react', 'vue' or false/);
   });
});
