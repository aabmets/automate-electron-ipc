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
import { type ChannelGroups, PreloadBindingsWriter } from "./preload-bindings.js";

/**
 * Writes `service-worker-preload.ts`, the preload script for service workers, which Electron runs
 * in the worker with `session.registerPreloadScript({ type: "service-worker", filePath })`. A worker
 * preload is sandboxed and context isolated like the one of a page, has `contextBridge` and
 * `ipcRenderer`, and exposes its API to the code of the worker through `contextBridge`. So the
 * script is that of a page, for the channels between a worker and the main process: a worker
 * calls the main process like a page does, and answers its questions like a page does.
 *
 * It is written only when the schema has such a channel. The isolated world and `getPathForFile`
 * of the config belong to pages, and are left out.
 */
export class ServiceWorkerPreloadWriter extends PreloadBindingsWriter {
   protected getTargetFilePath(): string {
      return this.config.serviceWorkerPreloadFilePath;
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
   /**
    * The channels of a worker are mapped to those of a page (see `groupChannels`), which the
    * serializer covers. The page channels of the schema are not the ones of this file, so only the
    * channels of a worker decide whether the file imports the serializer.
    */
   protected hasSerializedChannels(): boolean {
      return this.usesSerializer() && this.hasWorkerChannels();
   }
   /**
    * The preload script of a worker has no timers (`setTimeout` and `setImmediate` are not defined
    * there, only `queueMicrotask`), so the main process times the calls of a worker.
    */
   protected getTimeoutMs(): number {
      return 0;
   }
   protected groupChannels(): ChannelGroups {
      const groups: ChannelGroups = {
         portSpecs: [],
         askNames: [],
         streamSpecs: [],
         brokeredSpecs: [],
         channels: [],
      };
      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of parsedFileSpecs.specs.channelSpecArray) {
            if (this.isWorkerSpec(spec)) {
               this.groupChannel(this.asRendererSpec(spec) as t.ChannelSpec, groups);
            }
         }
      }
      return groups;
   }
}
