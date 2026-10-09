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

import fsp from "node:fs/promises";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import logger from "@src/logger.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   const automation = withAutomationDir();

   describe("the file for utility processes", () => {
      const generate = async (channels: string) => {
         const schemaPath = path.join(automation.dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, invoke, callUtility, invokeUtility } from "automate-electron-ipc";',
               `export default defineChannels({ ${channels} });`,
            ].join("\n"),
         );
         automation.mockConfig({
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         await ipcAutomation();
      };

      it("is written when the schema has a channel to the utility process", async () => {
         await generate("getUser: invoke<() => Promise<string>>(), run: callUtility<() => void>()");

         const utility = await fsp.readFile(path.join(automation.dir, "out/utility.ts"), "utf8");
         expect(utility).toContain("ANY CHANGES TO THIS FILE WILL NOT PERSIST");
         expect(utility).toContain("   run: {");
         expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).toContain(
            "attachUtility",
         );
      });

      it("is written to the configured path, whose directories are created", async () => {
         const utilityBindingsFilePath = path.join(automation.dir, "worker/generated/ipc.ts");
         const schemaPath = path.join(automation.dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, callUtility } from "automate-electron-ipc";',
               "export default defineChannels({ run: callUtility<() => void>() });",
            ].join("\n"),
         );
         automation.mockConfig({
            utilityBindingsFilePath,
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);

         await ipcAutomation();

         expect(await fsp.readFile(utilityBindingsFilePath, "utf8")).toContain("   run: {");
      });

      it("is written for a schema which has only a channel from a page to the utility process", async () => {
         await generate("run: invokeUtility<() => Promise<number>>()");

         const utility = await fsp.readFile(path.join(automation.dir, "out/utility.ts"), "utf8");
         expect(utility).toContain("   run: {\n      handle:");
         const main = await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8");
         expect(main).toContain("connectUtilityPort('run', child, target)");
         expect(await fsp.readFile(path.join(automation.dir, "out/preload.ts"), "utf8")).toContain(
            "callUtilityPort(utilityClients['run'], args)",
         );
      });

      it("is not written for a schema without such a channel", async () => {
         await generate("getUser: invoke<() => Promise<string>>()");

         await expect(fsp.stat(path.join(automation.dir, "out/utility.ts"))).rejects.toMatchObject({
            code: "ENOENT",
         });
         expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).not.toContain(
            "UtilityProcess",
         );
      });
   });
});
