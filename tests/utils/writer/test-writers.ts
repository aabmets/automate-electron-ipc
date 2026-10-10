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

import path from "node:path";
import { BaseWriter } from "@src/writer/base-writer.js";
import { MainBindingsWriter } from "@src/writer/main/main-bindings.js";
import { PreloadBindingsWriter } from "@src/writer/preload/preload-bindings.js";
import { ServiceWorkerPreloadWriter } from "@src/writer/preload/service-worker-preload.js";
import { HelperTypesWriter } from "@src/writer/renderer/helper-types.js";
import { ReactHooksWriter } from "@src/writer/renderer/hooks-react.js";
import { RendererTypesWriter } from "@src/writer/renderer/renderer-types.js";
import { ServiceWorkerTypesWriter } from "@src/writer/renderer/service-worker-types.js";
import { UtilityBindingsWriter } from "@src/writer/utility/utility-bindings.js";
import type * as t from "@types";

export class VitestBaseWriter extends BaseWriter {
   public getTargetFilePath(): string {
      return "";
   }
   public renderEmptyFileContents(): string {
      return "EMPTY FILE";
   }
   public renderFileContents(): string {
      return "const asdfg = 123;";
   }
   public getCodeIndents(): string[] {
      return super.getCodeIndents();
   }
   public joinComponents(components: string[]): string {
      return super.joinComponents(components);
   }
   public injectEventTypehint(
      signature: t.CallableSignature,
      eventType: string,
      eventName?: string,
   ): string {
      return super.injectEventTypehint(signature, eventType, eventName);
   }
   public getTypeParams(signature: t.CallableSignature): string {
      return super.getTypeParams(signature);
   }
   public getOriginalParams(spec: t.ChannelSpec, withTypes: boolean): string {
      return super.getOriginalParams(spec, withTypes);
   }
   public sortChannels<T extends { name: string }>(channels: T[]): T[] {
      return super.sortChannels(channels);
   }
   public getChannelSpecs(parsedFileSpecs: t.ParsedFileSpecs): t.ChannelSpec[] {
      return super.getChannelSpecs(parsedFileSpecs);
   }
   public getScopedFilePath(filePath: string): string {
      return super.getScopedFilePath(filePath);
   }
}
/** The class of a writer for the tests: specs first, a partial config, and a public target path. */
export interface TestWriterClass<W extends BaseWriter = BaseWriter> {
   new (
      pfsArray: t.ParsedFileSpecs[],
      config?: Partial<t.IPCResolvedConfig>,
      scope?: string | null,
   ): Omit<W, "getTargetFilePath"> & { getTargetFilePath(): string };
   prototype: unknown;
}

/**
 * A writer for the tests: the same class, with the specs first and a config that may be partial
 * (it gets `codeIndent: 3`), and a target path that `mockGetTargetFilePath` replaces.
 */
function createTestWriter<
   W extends new (
      config: t.IPCResolvedConfig,
      pfsArray: t.ParsedFileSpecs[],
      scope?: string | null,
   ) => BaseWriter,
>(Writer: W) {
   class TestWriter extends (Writer as new (...args: any[]) => BaseWriter) {
      constructor(
         pfsArray: t.ParsedFileSpecs[],
         config: Partial<t.IPCResolvedConfig> = {},
         scope: string | null = null,
      ) {
         super({ codeIndent: 3, ...config } as t.IPCResolvedConfig, pfsArray, scope);
      }
      public getTargetFilePath(): string {
         return "";
      }
      /** The types module is written next to the file, as it is in a run. */
      protected getTypesFilePath(): string {
         return path.join(path.dirname(this.getTargetFilePath()), "types.ts");
      }
   }
   return TestWriter as unknown as TestWriterClass<InstanceType<W>>;
}

export const VitestMainBindingsWriter = createTestWriter(MainBindingsWriter);
export const VitestPreloadBindingsWriter = createTestWriter(PreloadBindingsWriter);
export const VitestRendererTypesWriter = createTestWriter(RendererTypesWriter);
export const VitestHelperTypesWriter = createTestWriter(HelperTypesWriter);
export const VitestReactHooksWriter = createTestWriter(ReactHooksWriter);
export const VitestUtilityBindingsWriter = createTestWriter(UtilityBindingsWriter);
export const VitestServiceWorkerPreloadWriter = createTestWriter(ServiceWorkerPreloadWriter);
export const VitestServiceWorkerTypesWriter = createTestWriter(ServiceWorkerTypesWriter);
