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

import {
   ask,
   askWorker,
   defineChannels,
   emit,
   emitToWorker,
   invoke,
   invokeFromWorker,
   invokeUtility,
   mainPort,
   port,
   send,
   sendFromWorker,
   stream,
   streamUtility,
} from "@src/index.js";
import logger from "@src/logger.js";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("runtime stubs", () => {
   afterEach(() => vi.restoreAllMocks());

   it("returns the channel map unchanged and warns", () => {
      const spy = vi.spyOn(logger, "cannotExecuteChannels").mockImplementation(() => undefined);
      const map = { a: 1 };
      expect(defineChannels(map)).toBe(map);
      expect(spy).toHaveBeenCalledOnce();
   });

   it("makes every verb a no-op that warns", () => {
      const spy = vi.spyOn(logger, "cannotExecuteChannels").mockImplementation(() => undefined);
      for (const verb of [
         invoke,
         send,
         emit,
         ask,
         stream,
         port,
         mainPort,
         invokeUtility,
         streamUtility,
         invokeFromWorker,
         sendFromWorker,
         askWorker,
         emitToWorker,
      ]) {
         expect(verb()).toBeUndefined();
      }
      expect(spy).toHaveBeenCalledTimes(13);
   });
});
