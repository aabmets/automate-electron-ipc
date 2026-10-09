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

export const callUtility = {
   name: "indexFile",
   kind: "Unicast",
   direction: "MainToUtility",
} as const;
export const notifyUtility = {
   name: "setLevel",
   kind: "Broadcast",
   direction: "MainToUtility",
} as const;
export const callMain = {
   name: "getSetting",
   kind: "Unicast",
   direction: "UtilityToMain",
} as const;
export const notifyMain = {
   name: "progress",
   kind: "Broadcast",
   direction: "UtilityToMain",
} as const;
export const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;
