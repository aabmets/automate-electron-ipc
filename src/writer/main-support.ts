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
import { buildAskHelpers } from "./main-asks.js";
import type { MainContext } from "./main-bindings.js";
import { buildMainPortHelpers } from "./main-port-helpers.js";
import { buildPortHelpers, buildPortRegistry } from "./main-ports.js";
import { buildScopeRegistry, buildTargetResolver } from "./main-registries.js";
import { buildSenderHelpers } from "./main-senders.js";
import { buildStreamHelpers } from "./main-streams.js";
import { buildBrokerHelpers, buildUtilityHelpers } from "./main-utility.js";
import {
   buildArgumentValidation,
   buildSenderValidation,
   getValidatedWorkerEvents,
} from "./main-validation.js";
import { buildEventWatch, buildPageLoadWatch } from "./main-watches.js";
import { buildErrorEnvelope, buildSerializerRuntime } from "./utility-runtime.js";

/** Which helpers the channels of the file use. */
export interface SupportUses {
   usesIpcMain: boolean;
   usesValidation: boolean;
   usesEnvelope: boolean;
   usesSenders: boolean;
   usesEmits: boolean;
   usesAsks: boolean;
   usesPorts: boolean;
   usesRendererPorts: boolean;
   usesMainPorts: boolean;
   usesStreams: boolean;
   usesSerializer: boolean;
   usesUtility: boolean;
   usesBrokers: boolean;
   workerSpecs: t.ChannelSpec[];
   workerValidators: Map<t.ChannelSpec, string>;
   scopes: string[];
   usesScopedGuards: boolean;
   usesEventWatch: boolean;
}

/**
 * The builders of the helpers that are still methods of `MainBindingsWriter`. Each one moves to a
 * module of its feature, which `buildSupport` then calls directly.
 */
export interface SupportBuilders {
   workerHelpers: (
      specs: t.ChannelSpec[],
      usesAsks: boolean,
      validators: Map<t.ChannelSpec, string>,
   ) => string;
   workerEventType: (spec: t.ChannelSpec) => string;
}

/** The helpers that the channels of the file use, in the order that they are declared. */
export function buildSupport(
   ctx: MainContext,
   uses: SupportUses,
   eventTypes: string[],
   builders: SupportBuilders,
): string[] {
   const { indents } = ctx;
   const support: string[] = [];
   if (uses.scopes.length > 0) {
      support.push(buildScopeRegistry(indents, uses.scopes));
   }
   if (uses.usesIpcMain) {
      support.push(
         buildSenderValidation(indents, eventTypes, uses.usesValidation, uses.usesScopedGuards),
         buildTargetResolver(indents),
      );
   }
   if (uses.usesValidation || uses.workerValidators.size > 0) {
      support.push(
         buildArgumentValidation(
            indents,
            uses.usesValidation ? eventTypes : [],
            getValidatedWorkerEvents(uses.workerValidators, builders.workerEventType),
         ),
      );
   }
   if (uses.usesEnvelope) {
      // The envelope of `invoke` channels: `settleInvoke` runs the handler and answers with
      // `{ ok: true, value }`, or with `{ ok: false, error }` when anything fails, including the
      // rejection of the sender and the validation of the arguments. `toIpcError` reduces what was
      // thrown to `{ name, message, code?, data? }`. Electron reports a rejected handler to the
      // renderer as the text `Error invoking remote method`, so these fields would be lost, and the
      // stack never leaves the main process. `data` is dropped when it cannot be cloned, since it
      // would otherwise fail the whole reply.
      support.push(buildErrorEnvelope(indents));
   }
   if (uses.usesSerializer) {
      // The serializer of the config, for the channels between the main process and a page and for
      // the ones between the main process and a utility process (see `buildSerializerRuntime`).
      // `IpcSerializationError` reaches the caller of a `send`, `emit` or `ask`, and the page as the
      // `{ name, message, code }` of the usual error envelope. Deserializing is done only after the
      // sender is checked, so that a rejected sender reaches no code of the serializer.
      support.push(buildSerializerRuntime(indents));
   }
   if (uses.usesSenders) {
      support.push(buildSenderHelpers(indents, uses.usesEmits));
   }
   if (uses.usesEventWatch) {
      support.push(buildEventWatch(indents));
   }
   if (uses.usesAsks) {
      support.push(buildAskHelpers(ctx));
   }
   if (uses.workerSpecs.length > 0) {
      support.push(builders.workerHelpers(uses.workerSpecs, uses.usesAsks, uses.workerValidators));
   }
   if (uses.usesStreams) {
      support.push(buildStreamHelpers(ctx));
   }
   if (uses.usesUtility) {
      support.push(buildUtilityHelpers(indents, uses.usesSerializer));
   }
   if (uses.usesPorts) {
      support.push(buildPortRegistry(indents));
   }
   if (uses.usesPorts || uses.usesBrokers) {
      support.push(buildPageLoadWatch(indents));
   }
   if (uses.usesBrokers) {
      support.push(buildBrokerHelpers(indents));
   }
   if (uses.usesRendererPorts) {
      support.push(buildPortHelpers(indents));
   }
   if (uses.usesMainPorts) {
      support.push(buildMainPortHelpers(ctx));
   }
   return support;
}
