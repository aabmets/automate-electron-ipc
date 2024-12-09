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
import logger from "./logger.js";

export function Channel(): t.Channels {
   return {
      RendererToMain: {
         Unicast: logger.cannotExecuteChannels,
         Broadcast: logger.cannotExecuteChannels,
      },
      MainToRenderer: {
         Broadcast: logger.cannotExecuteChannels,
      },
      RendererToRenderer: {
         Port: logger.cannotExecuteChannels,
      },
   };
}

export const type = null;
