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

import type * as t from "@types";
import { parseTestSignature } from "./writer/writer-utils.js";

/** The smallest config that the validator of the optional config accepts, which tests extend. */
export const baseConfig = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

export class ChannelSpecGenerator {
   private index: number;

   constructor() {
      this.index = 0;
   }

   generate(
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      returnType = "void",
   ): t.ChannelSpec {
      const spec: t.ChannelSpec = {
         name: `vitestChannel_${this.index}`,
         kind,
         direction,
         signature: parseTestSignature(`() => ${returnType}`, [], kind === "Stream"),
      };
      ++this.index;
      return spec;
   }
}
