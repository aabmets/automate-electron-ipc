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

import { MainBindingsWriter } from "./main-bindings.js";
import { PreloadBindingsWriter } from "./preload-bindings.js";
import { RendererTypesWriter } from "./renderer-types.js";
import { ServiceWorkerPreloadWriter } from "./service-worker-preload.js";
import { ServiceWorkerTypesWriter } from "./service-worker-types.js";
import { UtilityBindingsWriter } from "./utility-bindings.js";

export default {
   MainBindingsWriter,
   PreloadBindingsWriter,
   RendererTypesWriter,
   ServiceWorkerPreloadWriter,
   ServiceWorkerTypesWriter,
   UtilityBindingsWriter,
};
