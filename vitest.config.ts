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

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
   test: {
      include: ["tests/**/*.test.ts"],
      coverage: {
         enabled: true,
         provider: "v8",
         include: ["src/**/*.ts"],
         reporter: ["text", "lcov", "html"],
         reportsDirectory: "coverage",
         thresholds: {
            perFile: true,
            statements: 90,
            branches: 90,
            functions: 90,
            lines: 90,
         },
      },
      server: {
         deps: {
            external: ["typescript"],
         },
      },
   },
   resolve: {
      alias: {
         "@types": path.resolve(import.meta.dirname, "./types/internal.d.ts"),
         "@testutils": path.resolve(import.meta.dirname, "./tests/utils"),
         "@src": path.resolve(import.meta.dirname, "./src"),
      },
   },
});
