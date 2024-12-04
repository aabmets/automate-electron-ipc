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
import { ImportsGenerator } from "./imports-generator.js";
import { MainBindingsWriter } from "./main-bindings.js";
import { PreloadBindingsWriter } from "./preload-bindings.js";
import { RendererTypesWriter } from "./renderer-types.js";

export default {
   BaseWriter,
   ImportsGenerator,
   MainBindingsWriter,
   PreloadBindingsWriter,
   RendererTypesWriter,
};
