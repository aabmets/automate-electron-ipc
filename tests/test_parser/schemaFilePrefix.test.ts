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

import { schemaFilePrefix } from "@src/parser/diagnostics.js";
import { describe, expect, it } from "vitest";

describe("schemaFilePrefix", () => {
   it("names the schema file and ends with a space", () => {
      expect(schemaFilePrefix("ipc/schema.ts")).toBe("Schema file 'ipc/schema.ts': ");
   });

   it("is empty when the file is unknown", () => {
      expect(schemaFilePrefix()).toBe("");
      expect(schemaFilePrefix(undefined)).toBe("");
   });
});
