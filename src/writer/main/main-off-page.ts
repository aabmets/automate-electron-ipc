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
import type { ChannelEntry, MainContext } from "./main-bindings.js";
import { buildBrokeredChannel, buildUtilityChannel } from "./main-utility.js";
import { buildWorkerChannel, usesWorkerEnvelope } from "./main-workers.js";

/** What the channels that are not between the main process and a renderer need. */
export interface OffPageUse {
   utility: boolean;
   brokers: boolean;
   envelope: boolean;
   workers: t.ChannelSpec[];
   /** The local names of the validators of the channels that a service worker calls. */
   validators: Map<t.ChannelSpec, string>;
}

/**
 * Builds the channel of a spec between the main process and a utility process, between a page
 * and a utility process or between the main process and a service worker, and notes what it
 * needs. The specs of the pages are built by the caller.
 */
export function buildOffPageChannels(
   ctx: MainContext,
   spec: t.ChannelSpec,
   values: Set<string>,
   types: Set<string>,
   uses: OffPageUse,
): ChannelEntry[] {
   if (ctx.isUtilitySpec(spec)) {
      uses.utility = true;
      uses.envelope = true;
      values.add("utilityProcess");
      types.add("UtilityProcess");
      return [buildUtilityChannel(ctx, spec)];
   } else if (ctx.isBrokeredSpec(spec)) {
      // The page is connected to a child which the peers know, so that its exit is seen.
      uses.utility = true;
      uses.envelope = true;
      uses.brokers = true;
      values.add("utilityProcess");
      types.add("UtilityProcess");
      return [buildBrokeredChannel(ctx, spec, values, types)];
   }
   // The specs left are the ones between the main process and a service worker.
   uses.workers.push(spec);
   uses.envelope ||= usesWorkerEnvelope(ctx, spec);
   return [buildWorkerChannel(ctx, spec)];
}
