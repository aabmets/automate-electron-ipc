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
import { GENERATED_PREFIX } from "@src/output-files.js";
import { withAutomationDir } from "@testutils/automation-utils.js";
import type * as t from "@types";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   const automation = withAutomationDir();

   describe("the files for service workers", () => {
      const generate = async (channels: string, overrides: Partial<t.IPCResolvedConfig> = {}) => {
         const schemaPath = path.join(automation.dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, invoke, invokeFromWorker, emitToWorker } from "automate-electron-ipc";',
               `export default defineChannels({ ${channels} });`,
            ].join("\n"),
         );
         automation.mockConfig({
            ipcSchema: { path: schemaPath, stats: await fsp.stat(schemaPath) },
            ...overrides,
         } as never);
         vi.spyOn(logger, "reportSuccess").mockImplementation(() => undefined);
         await ipcAutomation();
      };

      it("are written when the schema has a channel of a worker", async () => {
         await generate(
            "getUser: invoke<() => Promise<string>>(), token: invokeFromWorker<() => Promise<string>>()",
         );

         const preload = await fsp.readFile(
            path.join(automation.dir, "out/service-worker-preload.ts"),
            "utf8",
         );
         expect(preload).toContain(GENERATED_PREFIX);
         expect(preload).toContain("   token: {");
         expect(preload).not.toContain("getUser");
         const types = await fsp.readFile(
            path.join(automation.dir, "out/service-worker.d.ts"),
            "utf8",
         );
         expect(types).toContain("interface IpcApi {");
         expect(types).toContain("   token: {");
         expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).toContain(
            "attachServiceWorkers",
         );
         // The files of the page have the channels of the page only.
         const page = await fsp.readFile(path.join(automation.dir, "out/preload.ts"), "utf8");
         expect(page).toContain("getUser");
         expect(page).not.toContain("token");
      });

      it("are written to the configured paths, whose directories are created", async () => {
         await generate("token: invokeFromWorker<() => string>()", {
            serviceWorkerPreloadFilePath: path.join(automation.dir, "sw/generated/preload.ts"),
            serviceWorkerTypesFilePath: path.join(
               automation.dir,
               "sw/generated/service-worker.d.ts",
            ),
         });

         expect(
            await fsp.readFile(path.join(automation.dir, "sw/generated/preload.ts"), "utf8"),
         ).toContain("   token: {");
         expect(
            await fsp.readFile(
               path.join(automation.dir, "sw/generated/service-worker.d.ts"),
               "utf8",
            ),
         ).toContain("   token: {");
      });

      it("are written for a schema which has only a channel to a worker, and empty ones for the page", async () => {
         await generate("changed: emitToWorker<(key: string) => void>()");

         expect(
            await fsp.readFile(path.join(automation.dir, "out/service-worker.d.ts"), "utf8"),
         ).toContain("on: (callback: (key: string) => void) => () => void;");
         expect(await fsp.readFile(path.join(automation.dir, "out/preload.ts"), "utf8")).toContain(
            "export const api = {};",
         );
         expect(await fsp.readFile(path.join(automation.dir, "out/window.d.ts"), "utf8")).toContain(
            "interface IpcApi {}",
         );
      });

      it("are not written for a schema without such a channel", async () => {
         await generate("getUser: invoke<() => Promise<string>>()");

         await Promise.all(
            ["service-worker-preload.ts", "service-worker.d.ts"].map((file) =>
               expect(fsp.stat(path.join(automation.dir, "out", file))).rejects.toMatchObject({
                  code: "ENOENT",
               }),
            ),
         );
         expect(await fsp.readFile(path.join(automation.dir, "out/main.ts"), "utf8")).not.toContain(
            "ServiceWorkerMain",
         );
      });

      it("refuse a path which is the file of a scope, and write nothing", async () => {
         await fsp.writeFile(
            path.join(automation.dir, "schema.ts"),
            [
               'import { defineChannels, invoke, invokeFromWorker } from "automate-electron-ipc";',
               "export default defineChannels({",
               '   a: invoke<() => void>({ scopes: ["settings"] }),',
               "   b: invokeFromWorker<() => void>(),",
               "});",
            ].join("\n"),
         );
         automation.mockConfig({
            ipcSchema: {
               path: path.join(automation.dir, "schema.ts"),
               stats: await fsp.stat(path.join(automation.dir, "schema.ts")),
            },
            projectRoot: automation.dir,
            serviceWorkerPreloadFilePath: path.join(automation.dir, "out/preload.settings.ts"),
         } as never);

         await expect(ipcAutomation()).rejects.toThrowError(
            /'serviceWorkerPreloadPath' \(.*preload\.settings\.ts'\) is the file that the scope 'settings' is generated to/,
         );
         expect(await fsp.readdir(automation.dir)).toStrictEqual(["schema.ts"]);
      });
   });
});
