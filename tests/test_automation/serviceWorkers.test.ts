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
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcAutomation } from "@src/automation.js";
import logger from "@src/logger.js";
import { mockAutomationConfig } from "@testutils/automation-utils.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ipcAutomation", () => {
   let dir: string;

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-automation-"));
   });
   afterEach(async () => {
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   const mockConfig = (overrides: Partial<t.IPCResolvedConfig>) =>
      mockAutomationConfig(dir, overrides);

   describe("the files for service workers", () => {
      const generate = async (channels: string, overrides: Partial<t.IPCResolvedConfig> = {}) => {
         const schemaPath = path.join(dir, "schema.ts");
         await fsp.writeFile(
            schemaPath,
            [
               'import { defineChannels, invoke, invokeFromWorker, emitToWorker } from "automate-electron-ipc";',
               `export default defineChannels({ ${channels} });`,
            ].join("\n"),
         );
         mockConfig({
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
            path.join(dir, "out/service-worker-preload.ts"),
            "utf8",
         );
         expect(preload).toContain("ANY CHANGES TO THIS FILE WILL NOT PERSIST");
         expect(preload).toContain("   token: {");
         expect(preload).not.toContain("getUser");
         const types = await fsp.readFile(path.join(dir, "out/service-worker.d.ts"), "utf8");
         expect(types).toContain("interface IpcApi {");
         expect(types).toContain("   token: {");
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).toContain(
            "attachServiceWorkers",
         );
         // The files of the page have the channels of the page only.
         const page = await fsp.readFile(path.join(dir, "out/preload.ts"), "utf8");
         expect(page).toContain("getUser");
         expect(page).not.toContain("token");
      });

      it("are written to the configured paths, whose directories are created", async () => {
         await generate("token: invokeFromWorker<() => string>()", {
            serviceWorkerPreloadFilePath: path.join(dir, "sw/generated/preload.ts"),
            serviceWorkerTypesFilePath: path.join(dir, "sw/generated/service-worker.d.ts"),
         });

         expect(await fsp.readFile(path.join(dir, "sw/generated/preload.ts"), "utf8")).toContain(
            "   token: {",
         );
         expect(
            await fsp.readFile(path.join(dir, "sw/generated/service-worker.d.ts"), "utf8"),
         ).toContain("   token: {");
      });

      it("are written for a schema which has only a channel to a worker, and empty ones for the page", async () => {
         await generate("changed: emitToWorker<(key: string) => void>()");

         expect(await fsp.readFile(path.join(dir, "out/service-worker.d.ts"), "utf8")).toContain(
            "on: (callback: (key: string) => void) => () => void;",
         );
         expect(await fsp.readFile(path.join(dir, "out/preload.ts"), "utf8")).toContain(
            "export const api = {};",
         );
         expect(await fsp.readFile(path.join(dir, "out/window.d.ts"), "utf8")).toContain(
            "interface IpcApi {}",
         );
      });

      it("are not written for a schema without such a channel", async () => {
         await generate("getUser: invoke<() => Promise<string>>()");

         await Promise.all(
            ["service-worker-preload.ts", "service-worker.d.ts"].map((file) =>
               expect(fsp.stat(path.join(dir, "out", file))).rejects.toMatchObject({
                  code: "ENOENT",
               }),
            ),
         );
         expect(await fsp.readFile(path.join(dir, "out/main.ts"), "utf8")).not.toContain(
            "ServiceWorkerMain",
         );
      });

      it("refuse a path which is the file of a scope, and write nothing", async () => {
         await fsp.writeFile(
            path.join(dir, "schema.ts"),
            [
               'import { defineChannels, invoke, invokeFromWorker } from "automate-electron-ipc";',
               "export default defineChannels({",
               '   a: invoke<() => void>({ scopes: ["settings"] }),',
               "   b: invokeFromWorker<() => void>(),",
               "});",
            ].join("\n"),
         );
         mockConfig({
            ipcSchema: {
               path: path.join(dir, "schema.ts"),
               stats: await fsp.stat(path.join(dir, "schema.ts")),
            },
            projectRoot: dir,
            serviceWorkerPreloadFilePath: path.join(dir, "out/preload.settings.ts"),
         } as never);

         await expect(ipcAutomation()).rejects.toThrowError(
            /'serviceWorkerPreloadPath' \(.*preload\.settings\.ts'\) is the file that the scope 'settings' is generated to/,
         );
         expect(await fsp.readdir(dir)).toStrictEqual(["schema.ts"]);
      });
   });
});
