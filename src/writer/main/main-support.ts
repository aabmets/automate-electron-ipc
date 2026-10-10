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
import { buildErrorEnvelope, buildSerializerRuntime } from "../utility/utility-runtime.js";
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
import { buildWorkerHelpers } from "./main-worker-helpers.js";

interface SupportUses {
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

/** The helpers that the channels of the file use, in the order that they are declared. */
export function buildSupport(ctx: MainContext, uses: SupportUses, eventTypes: string[]): string[] {
   const { indents } = ctx;
   const needsValidation = uses.usesValidation || uses.workerValidators.size > 0;
   // Each entry is a condition and the helpers that it adds, built only when it holds.
   const sections: [boolean, () => string[]][] = [
      [uses.scopes.length > 0, () => [buildScopeRegistry(indents, uses.scopes)]],
      [
         uses.usesIpcMain,
         () => [
            buildSenderValidation(indents, eventTypes, uses.usesValidation, uses.usesScopedGuards),
            buildTargetResolver(indents),
         ],
      ],
      [
         needsValidation,
         () => [
            buildArgumentValidation(
               indents,
               uses.usesValidation ? eventTypes : [],
               getValidatedWorkerEvents(uses.workerValidators),
            ),
         ],
      ],
      // The envelope of `invoke` channels: `settleInvoke` runs the handler and answers with
      // `{ ok: true, value }`, or with `{ ok: false, error }` when anything fails, including the
      // rejection of the sender and the validation of the arguments. `toIpcError` reduces what was
      // thrown to `{ name, message, code?, data? }`. Electron reports a rejected handler to the
      // renderer as the text `Error invoking remote method`, so these fields would be lost, and the
      // stack never leaves the main process. `data` is dropped when it cannot be cloned, since it
      // would otherwise fail the whole reply.
      [uses.usesEnvelope, () => [buildErrorEnvelope(indents)]],
      // The serializer of the config, for the channels between the main process and a page and for
      // the ones between the main process and a utility process (see `buildSerializerRuntime`).
      // `IpcSerializationError` reaches the caller of a `send`, `emit` or `ask`, and the page as the
      // `{ name, message, code }` of the usual error envelope. Deserializing is done only after the
      // sender is checked, so that a rejected sender reaches no code of the serializer.
      [uses.usesSerializer, () => [buildSerializerRuntime(indents)]],
      [uses.usesSenders, () => [buildSenderHelpers(indents, uses.usesEmits)]],
      [uses.usesEventWatch, () => [buildEventWatch(indents)]],
      [uses.usesAsks, () => [buildAskHelpers(ctx)]],
      [
         uses.workerSpecs.length > 0,
         () => [buildWorkerHelpers(ctx, uses.workerSpecs, uses.usesAsks, uses.workerValidators)],
      ],
      [uses.usesStreams, () => [buildStreamHelpers(ctx)]],
      [uses.usesUtility, () => [buildUtilityHelpers(indents, uses.usesSerializer)]],
      [uses.usesPorts, () => [buildPortRegistry(indents)]],
      [uses.usesPorts || uses.usesBrokers, () => [buildPageLoadWatch(indents)]],
      [uses.usesBrokers, () => [buildBrokerHelpers(indents)]],
      [uses.usesRendererPorts, () => [buildPortHelpers(indents)]],
      [uses.usesMainPorts, () => [buildMainPortHelpers(ctx)]],
   ];
   return sections.flatMap(([used, build]) => (used ? build() : []));
}
