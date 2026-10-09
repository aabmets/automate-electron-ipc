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

/** Whether the channel is between the main process and a utility process. */
export function isUtilitySpec(spec: t.ChannelSpec): boolean {
   return spec.direction === "MainToUtility" || spec.direction === "UtilityToMain";
}

/**
 * Whether the channel is between a renderer and a utility process, over a port which the main
 * process brokers. The page uses it like the other channels of a renderer.
 */
export function isBrokeredSpec(spec: t.ChannelSpec): boolean {
   return spec.direction === "RendererToUtility";
}

/** Whether any schema file declares a channel between a renderer and a utility process. */
export function hasBrokeredChannels(pfsArray: t.ParsedFileSpecs[]): boolean {
   return pfsArray.some((pfs) => pfs.specs.channelSpecArray.some((spec) => isBrokeredSpec(spec)));
}

/** Whether any schema file declares a channel that a utility process takes part in. */
export function hasUtilityChannels(pfsArray: t.ParsedFileSpecs[]): boolean {
   return pfsArray.some((pfs) =>
      pfs.specs.channelSpecArray.some((spec) => isUtilitySpec(spec) || isBrokeredSpec(spec)),
   );
}

/** Whether the channel is between the main process and a service worker. */
export function isWorkerSpec(spec: t.ChannelSpec): boolean {
   return spec.direction === "ServiceWorkerToMain" || spec.direction === "MainToServiceWorker";
}

/** Whether any schema file declares a channel that a service worker takes part in. */
export function hasWorkerChannels(pfsArray: t.ParsedFileSpecs[]): boolean {
   return pfsArray.some((pfs) => pfs.specs.channelSpecArray.some((spec) => isWorkerSpec(spec)));
}

/**
 * The channel as the page writers see it: the API of a service worker is that of a page, so its
 * channels are written like the ones with the same shape between the main process and a renderer.
 * A call from a worker keeps its timeout, which the main process applies and the typings of the
 * worker declare. A question to a worker times out in the main process on its own, so it has none here.
 */
export function asRendererSpec(spec: t.ChannelSpec): t.ChannelSpec {
   return {
      ...spec,
      direction: spec.direction === "ServiceWorkerToMain" ? "RendererToMain" : "MainToRenderer",
      timeoutMs: spec.direction === "ServiceWorkerToMain" ? spec.timeoutMs : 0,
   };
}

/** The channels of a schema file that a renderer takes part in. */
export function getRendererSpecs(parsedFileSpecs: t.ParsedFileSpecs): t.ChannelSpec[] {
   return parsedFileSpecs.specs.channelSpecArray.filter(
      (spec) => !(isUtilitySpec(spec) || isWorkerSpec(spec)),
   );
}

/** Whether any schema file declares a channel that a renderer takes part in. */
export function hasRendererChannels(pfsArray: t.ParsedFileSpecs[]): boolean {
   return pfsArray.some((pfs) => getRendererSpecs(pfs).length > 0);
}
