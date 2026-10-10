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
import { withConfigProject } from "@testutils/config/config-project.js";
import { describe, expect, it } from "vitest";

const KNOWN_KEYS =
   "autoExpose, channelPrefix, codeIndent, exposeAs, format, getPathForFile, hooks, ipcDataDir, " +
   "isolatedWorldId, " +
   "mainBindingsPath, mock, preloadBindingsPath, projectUsesNodeNext, rawErrors, rendererTypesPath, " +
   "serializer, serviceWorkerPreloadPath, timeoutMs, utilityBindingsPath";

describe("unknown config key", () => {
   const project = withConfigProject();

   it("is named with the manifest as the source", async () => {
      // Regression for T38a: the message was superstruct's "Expected a value of type `never`".
      await project.write({}, { name: "project", config: { autoipc: { listner: true } } });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         `Unknown config key 'listner' in package.json#config.autoipc. Known keys: ${KNOWN_KEYS}.`,
      );
   });

   it.each([
      ["autoipc.config.json", '{ "listner": true }'],
      ["autoipc.config.mjs", "export default { listner: true };"],
      ["autoipc.config.ts", "export default { listner: true };"],
   ])("is named with %s as the source", async (name, text) => {
      await project.write({ [name]: text });
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         `Unknown config key 'listner' in ${name}. Known keys: ${KNOWN_KEYS}.`,
      );
   });

   it("is named with the file given by the config option as the source", async () => {
      await project.write({ "conf/my.json": '{ "listner": true }' });
      await expect(
         cfg.getResolvedConfig({ cwd: project.dir, configFile: "conf/my.json" }),
      ).rejects.toThrowError("Unknown config key 'listner' in conf/my.json.");
   });

   it("is named with the run options as the source for an override", async () => {
      await project.write({ "autoipc.config.json": "{}" });
      await expect(
         cfg.getResolvedConfig({
            cwd: project.dir,
            overrides: { listner: true } as never,
         }),
      ).rejects.toThrowError("Unknown config key 'listner' in the run options.");
   });
});

describe("invalid config value", () => {
   const project = withConfigProject();

   it.each([
      ["the manifest", "package.json#config.autoipc"],
      ["a config file", "autoipc.config.json"],
   ])("names %s as the source", async (label, source) => {
      if (label === "the manifest") {
         await project.write({}, { name: "project", config: { autoipc: { codeIndent: 9 } } });
      } else {
         await project.write({ "autoipc.config.json": '{ "codeIndent": 9 }' });
      }
      await expect(cfg.getResolvedConfig(project.dir)).rejects.toThrowError(
         `Invalid config in ${source}: At path: codeIndent -- value cannot be less than 2 or greater than 4`,
      );
   });

   it("names the run options as the source for an invalid override", async () => {
      await project.write({ "autoipc.config.json": '{ "codeIndent": 4 }' });
      await expect(
         cfg.getResolvedConfig({ cwd: project.dir, overrides: { codeIndent: 9 } }),
      ).rejects.toThrowError("Invalid config in the run options: At path: codeIndent");
   });
});
