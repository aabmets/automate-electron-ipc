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

import { validateChannelSpecs } from "@src/channel-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import { describe, expect, it } from "vitest";

describe("validateChannelSpecs, error messages", () => {
   it("names no file when it is not given one", () => {
      const spec = new ChannelSpecGenerator().generate("RendererToRenderer", "Port");
      expect(() => validateChannelSpecs([{ ...spec, maxQueue: -1 }])).toThrowError(
         /^Channel 'vitestChannel_0': maxQueue must be a non-negative integer or Infinity, found -1\.$/,
      );
   });
});
