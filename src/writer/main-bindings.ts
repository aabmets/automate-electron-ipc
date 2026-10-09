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
import { collectScopes } from "../scopes.js";
import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";
import {
   addScopeImports,
   addStreamImports,
   addTargetImports,
   buildImports,
   getImportedTypes,
   getIpcMainImport,
   importCustomTypes,
} from "./main-imports.js";
import { buildOffPageChannels, type OffPageUse } from "./main-off-page.js";
import { buildPort } from "./main-ports.js";
import { hasScopedGuards } from "./main-registries.js";
import { buildRendererToMainChannel, getEventType, hasEnvelope } from "./main-renderer-channels.js";
import { getMainReservedNames } from "./main-reserved-names.js";
import { buildMainToRendererChannel, getSenderTypes } from "./main-senders.js";
import { buildSupport } from "./main-support.js";
import { importValidator } from "./main-validation.js";
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
   /** Whether the config names a serializer. */
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
      isUtilitySpec: this.isUtilitySpec.bind(this),
      isBrokeredSpec: this.isBrokeredSpec.bind(this),
      collectIdentifiers: this.collectIdentifiers.bind(this),
      uniqueName: this.uniqueName.bind(this),
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
         rendererPorts: this.hasPorts("RendererToRenderer"),
         mainPorts: this.hasPorts("MainToRenderer"),
         brokered: this.hasBrokeredChannels(),
         serializer: this.usesSerializer(),
         eventWatch: this.usesEventWatch(),
         utility: this.hasUtilityChannels(),
         workers: this.hasWorkerChannels(),
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
      // Only the imports that the generated code uses.
      let usesIpcMain = false;
      const electronImportsSet = new Set<string>();
      const electronTypeImportsSet = new Set<string>();
      const importDeclarationsArray: string[] = [];
      const channels: ChannelEntry[] = [];
      let usesValidation = false;
      let usesEnvelope = false;
      let usesSenders = false;
      let usesStreams = false;
      const offPage: OffPageUse = {
         utility: false,
         brokers: false,
         envelope: false,
         workers: [],
         validators: new Map(),
      };
      const eventTypes = new Set<string>();

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.kind === "Port") {
               channels.push(buildPort(this.ctx, spec, electronImportsSet, electronTypeImportsSet));
            } else if (spec.direction === "RendererToMain") {
               usesIpcMain = true;
               electronTypeImportsSet.add(getEventType(spec));
               eventTypes.add(getEventType(spec));
               usesEnvelope ||= hasEnvelope(this.ctx, spec);
               usesStreams ||= spec.kind === "Stream";
               const validator = importValidator(
                  this.importsGenerator,
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               usesValidation ||= validator !== null;
               channels.push(buildRendererToMainChannel(this.ctx, spec, validator));
            } else if (spec.direction === "MainToRenderer") {
               usesSenders = true;
               electronImportsSet.add("webContents as electronWebContents");
               for (const type of getSenderTypes(spec)) {
                  electronTypeImportsSet.add(type);
               }
               channels.push(buildMainToRendererChannel(this.ctx, spec));
            } else {
               const validator = importValidator(
                  this.importsGenerator,
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               if (validator !== null) {
                  offPage.validators.set(spec, validator);
               }
               channels.push(
                  ...buildOffPageChannels(
                     this.ctx,
                     spec,
                     electronImportsSet,
                     electronTypeImportsSet,
                     offPage,
                  ),
               );
            }
            const specCustomTypes = new Set(getImportedTypes(spec, this.isBrokeredSpec(spec)));
            customTypes = customTypes.union(specCustomTypes);
         }
         importCustomTypes(
            this.importsGenerator,
            parsedFileSpecs,
            customTypes,
            importDeclarationsArray,
         );
      }
      usesEnvelope ||= offPage.envelope;
      if (this.hasSerializedChannels()) {
         importDeclarationsArray.push(this.buildSerializerImport());
      }
      addWorkerImports(offPage.workers, electronTypeImportsSet);
      addStreamImports(usesStreams, electronImportsSet, electronTypeImportsSet);
      addTargetImports(usesIpcMain, electronTypeImportsSet);
      const scopes = collectScopes(this.pfsArray);
      addScopeImports(scopes.length > 0, electronTypeImportsSet);
      const usesAsks = this.hasChannels("Unicast");
      const usesEmits = this.hasChannels("Broadcast");
      const usesRendererPorts = this.hasPorts("RendererToRenderer");
      const usesMainPorts = this.hasPorts("MainToRenderer");
      const usesPorts = usesRendererPorts || usesMainPorts;
      const out = buildImports(
         [...getIpcMainImport(usesIpcMain || usesAsks || usesPorts), ...electronImportsSet],
         [...electronTypeImportsSet],
         importDeclarationsArray,
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
            usesEventWatch: this.usesEventWatch(),
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
   /** Whether any schema file declares a channel of the kind from the main process to a renderer. */
   private hasChannels(kind: t.ChannelKind): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) => spec.direction === "MainToRenderer" && spec.kind === kind,
         ),
      );
   }
   /**
    * Whether the generated code watches events of contents, windows or children for the calls or
    * connections it holds open: `ask`, `stream`, `port` and `mainPort` channels, and the brokered
    * channels of a utility process.
    */
   private usesEventWatch(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) =>
               spec.kind === "Port" ||
               (spec.kind === "Stream" && spec.direction === "RendererToMain") ||
               (spec.kind === "Unicast" && spec.direction === "MainToRenderer") ||
               this.isBrokeredSpec(spec),
         ),
      );
   }
   /** Whether any schema file declares a channel between a renderer and a utility process. */
   private hasBrokeredChannels(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some((spec) => this.isBrokeredSpec(spec)),
      );
   }
   /** Whether any schema file declares a port channel with the direction. */
   private hasPorts(direction: t.ChannelDirection): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) => spec.kind === "Port" && spec.direction === direction,
         ),
      );
   }
}
