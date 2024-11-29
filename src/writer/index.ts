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

import { writeMainBindings } from "./main-bindings.js";
import { writePreloadBindings } from "./preload-bindings.js";
import { writeRendererTypes } from "./renderer-types.js";

export default { writeMainBindings, writePreloadBindings, writeRendererTypes };
