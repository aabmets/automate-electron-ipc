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

import { classifyChange } from "@src/watch.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

const config = {
   projectRoot: "/work/app",
   ipcSchema: { path: "/work/app/src/ipc/schema.ts", stats: null },
} as t.IPCResolvedConfig;

describe("classifyChange", () => {
   it.each([
      ["/work/app/src/ipc/schema.ts", "schema"],
      ["/work/app/src/ipc/schema/channels.ts", "schema"],
      ["/work/app/src/ipc/schema/deep/more.mts", "schema"],
      ["/work/app/package.json", "config"],
      ["/work/app/tsconfig.json", "config"],
      ["/work/app/autoipc.config.json", "config"],
   ])("tells %s is a %s change", (file, kind) => {
      expect(classifyChange(config, file)).toBe(kind);
   });

   it.each([
      "/work/app/src/ipc/main.ts",
      "/work/app/src/ipc/preload.ts",
      "/work/app/src/ipc/window.d.ts",
      "/work/app/src/ipc/schema/types.d.ts",
      "/work/app/src/ipc/schema/readme.md",
      "/work/app/src/App.tsx",
      "/work/app/src/package.json",
      "/work/other/package.json",
      "/work/app",
   ])("ignores %s", (file) => {
      expect(classifyChange(config, file)).toBeNull();
   });

   it("knows the config file outside the project root", () => {
      expect(classifyChange(config, "/work/shared/ipc.json", "/work/shared/ipc.json")).toBe(
         "config",
      );
      expect(classifyChange(config, "/work/shared/other.json", "/work/shared/ipc.json")).toBeNull();
   });
});
