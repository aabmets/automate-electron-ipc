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

import { allSpecs, anySpec } from "@src/writer/channel-kinds.js";
import { buildFileSpecs } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

const files = [
   ...buildFileSpecs(
      { name: "first", kind: "Unicast", direction: "RendererToMain" },
      { name: "second", kind: "Broadcast", direction: "MainToRenderer" },
   ),
   ...buildFileSpecs({ name: "third", kind: "Unicast", direction: "MainToUtility" }),
];

describe("anySpec", () => {
   it("looks through the channels of every file", () => {
      expect(anySpec(files, (spec) => spec.name === "third")).toBe(true);
      expect(anySpec(files, (spec) => spec.name === "first")).toBe(true);
   });

   it("is false when no channel matches, and for no files", () => {
      expect(anySpec(files, (spec) => spec.name === "missing")).toBe(false);
      expect(anySpec([], () => true)).toBe(false);
   });
});

describe("allSpecs", () => {
   it("lists the channels of all files in the order of the files", () => {
      expect(allSpecs(files).map((spec) => spec.name)).toStrictEqual(["first", "second", "third"]);
   });

   it("is empty for no files", () => {
      expect(allSpecs([])).toStrictEqual([]);
   });
});
