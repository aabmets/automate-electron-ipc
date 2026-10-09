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
import { watchedPaths } from "@src/watch.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

function configOf(ipcDataDir: string): t.IPCResolvedConfig {
   return {
      projectRoot: "/work/app",
      ipcSchema: { path: `${ipcDataDir}/schema.ts`, stats: null },
   } as t.IPCResolvedConfig;
}

describe("watchedPaths", () => {
   it("lists the schema directory and the project root", () => {
      expect(watchedPaths(configOf("/work/app/src/ipc"))).toEqual([
         "/work/app/src/ipc",
         "/work/app",
      ]);
   });

   it("names the directory of a schema folder, not the folder", () => {
      const config = configOf("/work/app/src/ipc");
      config.ipcSchema.path = "/work/app/src/ipc/schema";

      expect(watchedPaths(config)).toEqual(["/work/app/src/ipc", "/work/app"]);
   });

   it("adds the directory of the config file, relative to the working directory or absolute", () => {
      const config = configOf("/work/app/src/ipc");
      const relative = path.resolve("conf/ipc.config.ts").replaceAll("\\", "/");

      expect(watchedPaths(config, "/work/shared/ipc.config.json")).toEqual([
         "/work/app/src/ipc",
         "/work/app",
         "/work/shared",
      ]);
      expect(watchedPaths(config, "conf/ipc.config.ts")).toContain(path.posix.dirname(relative));
   });

   it("lists a directory once when the config file is in the project root", () => {
      expect(watchedPaths(configOf("/work/app/ipc"), "/work/app/my.config.json")).toEqual([
         "/work/app/ipc",
         "/work/app",
      ]);
   });

   it("lists the project root once when the schema sits in it", () => {
      expect(watchedPaths(configOf("/work/app"))).toEqual(["/work/app"]);
   });
});
