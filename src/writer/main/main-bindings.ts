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
import { collectScopes } from "../../scopes.js";
import utils from "../../utils.js";
import { BaseWriter } from "../base-writer.js";
import {
   hasBrokeredChannels,
   hasUtilityChannels,
   hasWorkerChannels,
   isBrokeredSpec,
   isUtilitySpec,
} from "../channel-kinds.js";
import { collectIdentifiers, uniqueName } from "../param-names.js";
import { buildSerializerImport } from "../utility/utility-runtime.js";
import { collectMainChannels, hasChannels, hasPorts, usesEventWatch } from "./main-collect.js";
import {
   addScopeImports,
   addStreamImports,
   addTargetImports,
   buildImports,
   getIpcMainImport,
} from "./main-imports.js";
import { hasScopedGuards } from "./main-registries.js";
import { getMainReservedNames } from "./main-reserved-names.js";
import { buildSupport } from "./main-support.js";
import { addWorkerImports } from "./main-workers.js";

export interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
}

/**
 * What the modules of the generated `main.ts` read from the writer: the indents, the config, and
 * the helpers of `BaseWriter` that they call, bound to the writer. A function which reads only the
 * indents takes `indents` instead.
 */
export interface MainContext {
   indents: string[];
   config: t.IPCResolvedConfig;
   usesSerializer: boolean;
   wireName: (name: string, suffix?: string) => string;
   isSerializedSpec: (spec: t.ChannelSpec) => boolean;
   isUtilitySpec: (spec: t.ChannelSpec) => boolean;
   isBrokeredSpec: (spec: t.ChannelSpec) => boolean;
   collectIdentifiers: (snippets: string[]) => Set<string>;
   uniqueName: (base: string, taken: Set<string>) => string;
   getOriginalParams: (spec: t.ChannelSpec, onlyNames: boolean) => string;
   getTypeParams: (signature: t.CallableSignature) => string;
   injectEventTypehint: (
      signature: t.CallableSignature,
      eventType: string,
      eventName?: string,
   ) => string;
   getHighWaterMark: (spec: t.ChannelSpec) => string;
   getMaxQueue: (spec: t.ChannelSpec) => string;
   getTimeoutMs: (spec: t.ChannelSpec) => number;
   getTimeoutArgument: (spec: t.ChannelSpec) => string;
}

export class MainBindingsWriter extends BaseWriter {
   private readonly ctx: MainContext = {
      indents: this.indents,
      config: this.config,
      usesSerializer: this.usesSerializer(),
      wireName: this.wireName.bind(this),
      isSerializedSpec: this.isSerializedSpec.bind(this),
      isUtilitySpec,
      isBrokeredSpec,
      collectIdentifiers,
      uniqueName,
      getOriginalParams: this.getOriginalParams.bind(this),
      getTypeParams: this.getTypeParams.bind(this),
      injectEventTypehint: this.injectEventTypehint.bind(this),
      getHighWaterMark: this.getHighWaterMark.bind(this),
      getMaxQueue: this.getMaxQueue.bind(this),
      getTimeoutMs: this.getTimeoutMs.bind(this),
      getTimeoutArgument: this.getTimeoutArgument.bind(this),
   };
   protected getTargetFilePath(): string {
      return this.config.mainBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      return getMainReservedNames({
         rendererPorts: hasPorts(this.pfsArray, "RendererToRenderer"),
         mainPorts: hasPorts(this.pfsArray, "MainToRenderer"),
         brokered: hasBrokeredChannels(this.pfsArray),
         serializer: this.usesSerializer(),
         eventWatch: usesEventWatch(this.pfsArray),
         utility: hasUtilityChannels(this.pfsArray),
         workers: hasWorkerChannels(this.pfsArray),
      });
   }
   /**
    * The main process only pairs the pages of a `port` channel, and brokers the port between a page and
    * a utility process, and sees none of their messages.
    */
   protected isSerializedSpec(spec: t.ChannelSpec): boolean {
      return (
         spec.direction !== "RendererToRenderer" &&
         spec.direction !== "RendererToUtility" &&
         super.isSerializedSpec(spec)
      );
   }
   protected renderEmptyFileContents(): string {
      return "export const ipc = {};";
   }
   protected renderFileContents(): string {
      const {
         channels,
         electronImports,
         electronTypeImports,
         importDeclarations,
         eventTypes,
         offPage,
         usesIpcMain,
         usesValidation,
         usesEnvelope,
         usesSenders,
         usesStreams,
      } = collectMainChannels(
         this.ctx,
         this.importsGenerator,
         this.pfsArray,
         this.getChannelSpecs.bind(this),
      );
      if (this.hasSerializedChannels()) {
         importDeclarations.push(buildSerializerImport(this.config, this.importsGenerator));
      }
      addWorkerImports(offPage.workers, electronTypeImports);
      addStreamImports(usesStreams, electronImports, electronTypeImports);
      addTargetImports(usesIpcMain, electronTypeImports);
      const scopes = collectScopes(this.pfsArray);
      addScopeImports(scopes.length > 0, electronTypeImports);
      const usesAsks = hasChannels(this.pfsArray, "Unicast");
      const usesEmits = hasChannels(this.pfsArray, "Broadcast");
      const usesRendererPorts = hasPorts(this.pfsArray, "RendererToRenderer");
      const usesMainPorts = hasPorts(this.pfsArray, "MainToRenderer");
      const usesPorts = usesRendererPorts || usesMainPorts;
      const out = buildImports(
         [...getIpcMainImport(usesIpcMain || usesAsks || usesPorts), ...electronImports],
         [...electronTypeImports],
         importDeclarations,
      );
      const [i0] = this.indents;
      const bindingsExpression = buildSupport(
         this.ctx,
         {
            usesIpcMain,
            usesValidation,
            usesEnvelope,
            usesSenders,
            usesEmits,
            usesAsks,
            usesPorts,
            usesRendererPorts,
            usesMainPorts,
            usesStreams,
            usesSerializer: this.hasSerializedChannels(),
            usesUtility: offPage.utility,
            usesBrokers: offPage.brokers,
            workerSpecs: offPage.workers,
            workerValidators: offPage.validators,
            scopes,
            usesScopedGuards: hasScopedGuards(this.pfsArray),
            usesEventWatch: usesEventWatch(this.pfsArray),
         },
         [...eventTypes].sort(utils.compareStrings),
      );
      bindingsExpression.push("\nexport const ipc = {");
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return this.joinComponents(out);
   }
}
