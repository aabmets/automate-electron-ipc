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

import { BaseWriter } from "./base-writer.js";

export class PreloadBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.resolvedConfig.preloadBindingsFilePath;
   }
   protected renderFileContents(): string {
      return ""; // TODO
   }
}
