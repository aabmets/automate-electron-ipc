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
import { anySpec, isBrokeredSpec } from "../channel-kinds.js";
import type { ImportsGenerator } from "../imports-generator.js";
import type { ChannelEntry, MainContext } from "./main-bindings.js";
import { getImportedTypes, importCustomTypes } from "./main-imports.js";
import { buildOffPageChannels, type OffPageUse } from "./main-off-page.js";
import { buildPort } from "./main-ports.js";
import { buildRendererToMainChannel, getEventType, hasEnvelope } from "./main-renderer-channels.js";
import { buildMainToRendererChannel, getSenderTypes } from "./main-senders.js";
import { importValidator } from "./main-validation.js";

/** What the channels of the schema files need in the generated `main.ts`, and their members. */
export interface MainCollection {
   channels: ChannelEntry[];
   electronImports: Set<string>;
   electronTypeImports: Set<string>;
   importDeclarations: string[];
   /** The types of the events that the handlers and listeners take. */
   eventTypes: Set<string>;
   offPage: OffPageUse;
   usesIpcMain: boolean;
   usesValidation: boolean;
   usesEnvelope: boolean;
   usesSenders: boolean;
   usesStreams: boolean;
}

function collectOffPageValidator(
   importsGenerator: ImportsGenerator,
   parsedFileSpecs: t.ParsedFileSpecs,
   spec: t.ChannelSpec,
   collection: MainCollection,
): void {
   const validator = importValidator(
      importsGenerator,
      parsedFileSpecs,
      spec,
      collection.importDeclarations,
   );
   if (validator !== null) {
      collection.offPage.validators.set(spec, validator);
   }
}

/**
 * Builds the channels of every schema file, and collects the imports and the features that the
 * generated code uses, so that it contains only what the channels need.
 *
 * @param ctx - What the modules of `main.ts` read from the writer.
 * @param importsGenerator - Spells the imports of the types of the schema files.
 * @param pfsArray - The schema files.
 * @param getChannelSpecs - The channels of a schema file, with the renamed types.
 */
export function collectMainChannels(
   ctx: MainContext,
   importsGenerator: ImportsGenerator,
   pfsArray: t.ParsedFileSpecs[],
   getChannelSpecs: (parsedFileSpecs: t.ParsedFileSpecs) => t.ChannelSpec[],
): MainCollection {
   const collection: MainCollection = {
      channels: [],
      electronImports: new Set(),
      electronTypeImports: new Set(),
      importDeclarations: [],
      eventTypes: new Set(),
      offPage: {
         utility: false,
         brokers: false,
         envelope: false,
         workers: [],
         validators: new Map(),
      },
      usesIpcMain: false,
      usesValidation: false,
      usesEnvelope: false,
      usesSenders: false,
      usesStreams: false,
   };
   const { channels, electronImports, electronTypeImports, importDeclarations, offPage } =
      collection;

   for (const parsedFileSpecs of pfsArray) {
      let customTypes: Set<string> = new Set();

      for (const spec of getChannelSpecs(parsedFileSpecs)) {
         if (spec.kind === "Port") {
            channels.push(buildPort(ctx, spec, electronImports, electronTypeImports));
         } else if (spec.direction === "RendererToMain") {
            collection.usesIpcMain = true;
            electronTypeImports.add(getEventType(spec));
            collection.eventTypes.add(getEventType(spec));
            collection.usesEnvelope ||= hasEnvelope(ctx, spec);
            collection.usesStreams ||= spec.kind === "Stream";
            const validator = importValidator(
               importsGenerator,
               parsedFileSpecs,
               spec,
               importDeclarations,
            );
            collection.usesValidation ||= validator !== null;
            channels.push(buildRendererToMainChannel(ctx, spec, validator));
         } else if (spec.direction === "MainToRenderer") {
            collection.usesSenders = true;
            electronImports.add("webContents as electronWebContents");
            for (const type of getSenderTypes(spec)) {
               electronTypeImports.add(type);
            }
            channels.push(buildMainToRendererChannel(ctx, spec));
         } else {
            collectOffPageValidator(importsGenerator, parsedFileSpecs, spec, collection);
            channels.push(
               ...buildOffPageChannels(ctx, spec, electronImports, electronTypeImports, offPage),
            );
         }
         const specCustomTypes = new Set(getImportedTypes(spec, isBrokeredSpec(spec)));
         customTypes = customTypes.union(specCustomTypes);
      }
      importCustomTypes(importsGenerator, parsedFileSpecs, customTypes, importDeclarations);
   }
   collection.usesEnvelope ||= offPage.envelope;
   return collection;
}

/** Whether any schema file declares a channel of the kind from the main process to a renderer. */
export function hasChannels(pfsArray: t.ParsedFileSpecs[], kind: t.ChannelKind): boolean {
   return anySpec(pfsArray, (spec) => spec.direction === "MainToRenderer" && spec.kind === kind);
}

export function hasPorts(pfsArray: t.ParsedFileSpecs[], direction: t.ChannelDirection): boolean {
   return anySpec(pfsArray, (spec) => spec.kind === "Port" && spec.direction === direction);
}

/**
 * Whether the generated code watches events of contents, windows or children for the calls or
 * connections it holds open: `ask`, `stream`, `port` and `mainPort` channels, and the brokered
 * channels of a utility process.
 */
export function usesEventWatch(pfsArray: t.ParsedFileSpecs[]): boolean {
   return anySpec(
      pfsArray,
      (spec) =>
         spec.kind === "Port" ||
         (spec.kind === "Stream" && spec.direction === "RendererToMain") ||
         (spec.kind === "Unicast" && spec.direction === "MainToRenderer") ||
         isBrokeredSpec(spec),
   );
}
