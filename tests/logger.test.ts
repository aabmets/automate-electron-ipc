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

import logger from "@src/logger.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("logger", () => {
   let warnSpy: ReturnType<typeof vi.spyOn>;

   beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
   });
   afterEach(() => {
      vi.restoreAllMocks();
      Reflect.deleteProperty(global, "warnedIncorrectUsageOnce");
   });

   const output = () => String(warnSpy.mock.calls.at(-1)?.[0]);

   it("warns about a non-existent schema path", () => {
      logger.nonExistentSchemaPath("/p/schema.ts");
      expect(output()).toContain("schema path does not exist:");
      expect(output()).toContain("/p/schema.ts");
   });

   it("warns when no channel expressions were found", () => {
      logger.noChannelExpressions("/p/schema.ts");
      expect(output()).toContain("no channels were found in path:");
      expect(output()).toContain("/p/schema.ts");
   });

   it("warns about executing channels only once", () => {
      logger.cannotExecuteChannels();
      logger.cannotExecuteChannels();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(output()).toContain("have no effect when executed by JavaScript");
   });

   it("reports a trimmed path when the relative path is part of the full path", () => {
      const spec = (n: number) => Array.from({ length: n }) as never[];
      logger.reportSuccess([
         {
            fullPath: "/project/src/ipc/schema/user.ts",
            relativePath: "./schema/user.ts",
            specs: { channelSpecArray: spec(2) },
         },
         {
            fullPath: "/elsewhere/other.ts",
            relativePath: "schema/missing.ts",
            specs: { channelSpecArray: spec(1) },
         },
      ] as never);
      expect(output()).toContain("Successfully generated IPC bindings:");
      expect(output()).toContain("2 channels from path 'schema/user.ts'");
      expect(output()).toContain("1 channels from path '/elsewhere/other.ts'");
   });
});
