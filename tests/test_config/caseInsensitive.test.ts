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
import utils from "@src/utils.js";
import {
   mockFspReadFile,
   mockFspStatsByPath,
   mockResolveUserProjectPath,
} from "@testutils/writer/shared-mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getResolvedConfig", () => {
   beforeEach(mockResolveUserProjectPath);
   afterEach(vi.restoreAllMocks);

   describe("output paths on a file system that ignores case", () => {
      const DIR = "/home/user/project/src/autoipc";
      const resolve = async (
         autoipc: Record<string, unknown>,
         insensitive: boolean,
         entries: Record<string, "directory" | "file"> = {},
      ) => {
         vi.spyOn(utils, "isCaseInsensitiveFileSystem").mockResolvedValue(insensitive);
         mockFspStatsByPath(entries);
         mockFspReadFile({ config: { autoipc } });
         return await cfg.getResolvedConfig();
      };

      it("probes the data directory of the project", async () => {
         await resolve({}, false);
         expect(utils.isCaseInsensitiveFileSystem).toHaveBeenCalledWith(DIR);
      });

      it.each([
         ["utilityBindingsPath", "Main.ts"],
         ["utilityBindingsPath", "PRELOAD.ts"],
         ["utilityBindingsPath", "Window.D.ts"],
         ["serviceWorkerPreloadPath", "MAIN.ts"],
      ])("refuses %s as %s, a generated file under another case", async (option, name) => {
         const path = `src/autoipc/${name}`;
         await expect(resolve({ [option]: path }, true)).rejects.toThrowError(
            `The config '${option}' ('${path}') is the path of another generated file.`,
         );
      });

      it("accepts the same paths on a file system that tells cases apart", async () => {
         const config = await resolve(
            {
               utilityBindingsPath: "src/autoipc/Main.ts",
               serviceWorkerPreloadPath: "src/autoipc/MAIN.ts",
            },
            false,
         );
         expect(config.utilityBindingsFilePath).toBe(`${DIR}/Main.ts`);
         expect(config.serviceWorkerPreloadFilePath).toBe(`${DIR}/MAIN.ts`);
      });

      it("refuses the service worker preload as the utility bindings under another case", async () => {
         const autoipc = {
            utilityBindingsPath: "src/sw/Utility.ts",
            serviceWorkerPreloadPath: "src/sw/utility.ts",
         };
         await expect(resolve(autoipc, true)).rejects.toThrowError(
            /'serviceWorkerPreloadPath' .* is the path of another generated file/,
         );
         await expect(resolve(autoipc, false)).resolves.toBeDefined();
      });

      it("refuses the schema file under another case", async () => {
         await expect(
            resolve({ utilityBindingsPath: "src/autoipc/SCHEMA.ts" }, true),
         ).rejects.toThrowError(/is the schema file/);
         await expect(
            resolve({ utilityBindingsPath: "src/autoipc/Schema.ts" }, false),
         ).resolves.toBeDefined();
      });

      it("refuses a file under the schema directory under another case", async () => {
         const entries = { [`${DIR}/schema`]: "directory" as const };
         await expect(
            resolve({ utilityBindingsPath: "src/autoipc/SCHEMA/out.ts" }, true, entries),
         ).rejects.toThrowError(/is a schema file/);
         await expect(
            resolve({ utilityBindingsPath: "src/autoipc/SCHEMA/out.ts" }, false, entries),
         ).resolves.toBeDefined();
      });

      it("refuses the serializer module under another case", async () => {
         const autoipc = {
            serializer: "./src/autoipc/serializer",
            utilityBindingsPath: "src/autoipc/Serializer.ts",
         };
         await expect(resolve(autoipc, true)).rejects.toThrowError(/is the serializer module/);
         await expect(resolve(autoipc, false)).resolves.toBeDefined();
      });
   });
});
