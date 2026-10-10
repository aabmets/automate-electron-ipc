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

import cfg from "@src/config.js";
import {
   mockFspReadFile,
   mockFspStatsByPath,
   mockResolveUserProjectPath,
} from "@testutils/writer/shared-mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getResolvedConfig, the hooks", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   const resolve = async (autoipc: Record<string, unknown>) => {
      mockFspStatsByPath({});
      mockFspReadFile({ config: { autoipc } });
      return await cfg.getResolvedConfig();
   };

   it("are off by default", async () => {
      expect((await resolve({})).hooks).toBe(false);
   });

   it.each([
      [false, "hooks.react.ts"],
      ["react", "hooks.react.ts"],
      ["vue", "hooks.vue.ts"],
   ])("go to the file for hooks %j, in the data directory", async (hooks, name) => {
      const config = await resolve({ ipcDataDir: "src/ipc", hooks });

      expect(config.hooksFilePath).toBe(`/home/user/project/src/ipc/${name}`);
   });

   it("keeps a path that clashes with the hooks file when no hooks are written", async () => {
      const config = await resolve({ mainBindingsPath: "src/autoipc/hooks.react.ts" });

      expect(config.mainBindingsFilePath).toBe("/home/user/project/src/autoipc/hooks.react.ts");
   });

   it.each([
      ["mainBindingsPath", "react", "hooks.react.ts"],
      ["preloadBindingsPath", "react", "hooks.react.ts"],
      ["utilityBindingsPath", "react", "hooks.react.ts"],
      ["serviceWorkerPreloadPath", "vue", "hooks.vue.ts"],
   ])("refuse the path of the hooks file for %s", async (option, hooks, name) => {
      const path = `src/autoipc/${name}`;

      await expect(resolve({ hooks, [option]: path })).rejects.toThrowError(
         `The config '${option}' ('${path}') is the path of another generated file.`,
      );
   });
});
