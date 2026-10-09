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
import { RendererTypesWriter } from "./renderer-types.js";

/**
 * Writes `service-worker.d.ts`, the declaration of the API that the preload script of a service
 * worker exposes to the code of the worker. It declares the same global as `window.d.ts` does for
 * a page, so a project includes the one that fits the code it compiles: the typings of the worker
 * go in the project of the worker script, which has the `webworker` lib and not the DOM one.
 */
export class ServiceWorkerTypesWriter extends RendererTypesWriter {
   protected getTargetFilePath(): string {
      return this.config.serviceWorkerTypesFilePath;
   }
   /** Whether the schema has anything for this file, which is not written otherwise. */
   public hasChannels(): boolean {
      return this.hasWorkerChannels();
   }
   protected isEmpty(): boolean {
      return !this.hasWorkerChannels();
   }
   protected getWorldId(): number | undefined {
      return undefined;
   }
   protected getPathForFileEnabled(): boolean {
      return false;
   }
   protected buildChannelEntry(spec: t.ChannelSpec) {
      return this.isWorkerSpec(spec) ? super.buildChannelEntry(this.asRendererSpec(spec)) : null;
   }
}
