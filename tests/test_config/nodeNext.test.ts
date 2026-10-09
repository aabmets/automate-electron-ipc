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

const tsconfig = (compilerOptions: object) => JSON.stringify({ compilerOptions });

describe("projectUsesNodeNext detection", () => {
   const project = withConfigProject();
   const detect = async () => (await cfg.getResolvedConfig(project.dir)).projectUsesNodeNext;

   it("is false without a tsconfig.json", async () => {
      await project.write({});
      expect(await detect()).toBe(false);
   });

   it("is false for a tsconfig.json that sets neither option", async () => {
      await project.write({ "tsconfig.json": "{}" });
      expect(await detect()).toBe(false);
   });

   it("is false for a bundler or node resolution", async () => {
      await project.write({
         "tsconfig.json": tsconfig({ module: "ESNext", moduleResolution: "Bundler" }),
      });
      expect(await detect()).toBe(false);
   });

   it("is true for module NodeNext", async () => {
      await project.write({ "tsconfig.json": tsconfig({ module: "NodeNext" }) });
      expect(await detect()).toBe(true);
   });

   it("is true for moduleResolution node16, in any case", async () => {
      await project.write({ "tsconfig.json": tsconfig({ moduleResolution: "node16" }) });
      expect(await detect()).toBe(true);
      await project.write({ "tsconfig.json": tsconfig({ moduleResolution: "Node16" }) });
      expect(await detect()).toBe(true);
   });

   it("reads comments and trailing commas, and leaves strings alone", async () => {
      await project.write({
         "tsconfig.json": [
            "// the compiler options",
            "{",
            '  "compilerOptions": {',
            "    /* a block",
            "       comment */",
            '    "paths": { "@/*": ["./src/*", ], }, // trailing commas',
            '    "outDir": "//not-a-comment/*nor-this*/,]",',
            '    "module": "nodenext",',
            "  },",
            "}",
         ].join("\n"),
      });
      expect(await detect()).toBe(true);
   });

   it("reads a file with a byte order mark", async () => {
      await project.write({ "tsconfig.json": `﻿${tsconfig({ module: "node16" })}` });
      expect(await detect()).toBe(true);
   });

   it("follows a relative extends of one level", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
         "tsconfig.base.json": tsconfig({ module: "NodeNext" }),
      });
      expect(await detect()).toBe(true);
   });

   it("follows a relative extends of two levels, without the .json extension", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: "./configs/mid" }),
         "configs/mid.json": JSON.stringify({ extends: "../root.json" }),
         "root.json": tsconfig({ moduleResolution: "node16" }),
      });
      expect(await detect()).toBe(true);
   });

   it("lets the file win over its base", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({
            extends: "./base.json",
            compilerOptions: { module: "ESNext", moduleResolution: "Bundler" },
         }),
         "base.json": tsconfig({ module: "NodeNext", moduleResolution: "NodeNext" }),
      });
      expect(await detect()).toBe(false);
   });

   it("lets the later entry of an extends array win", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: ["./a.json", "./b.json"] }),
         "a.json": tsconfig({ module: "NodeNext", moduleResolution: "NodeNext" }),
         "b.json": tsconfig({ module: "ESNext", moduleResolution: "Bundler" }),
      });
      expect(await detect()).toBe(false);
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: ["./b.json", "./a.json"] }),
      });
      expect(await detect()).toBe(true);
   });

   it("ignores a package extends", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: "@tsconfig/node22/tsconfig.json" }),
      });
      expect(await detect()).toBe(false);
   });

   it("survives an extends cycle", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: "./other.json" }),
         "other.json": JSON.stringify({
            extends: "./tsconfig.json",
            compilerOptions: { module: "node16" },
         }),
      });
      expect(await detect()).toBe(true);
   });

   it("does not read tsconfig.node.json or tsconfig.web.json", async () => {
      await project.write({
         "tsconfig.node.json": tsconfig({ module: "NodeNext" }),
         "tsconfig.web.json": tsconfig({ module: "NodeNext" }),
      });
      expect(await detect()).toBe(false);
   });

   it("lets an explicit false in the manifest beat a NodeNext tsconfig", async () => {
      await project.write(
         { "tsconfig.json": tsconfig({ module: "NodeNext" }) },
         { name: "project", config: { autoipc: { projectUsesNodeNext: false } } },
      );
      expect(await detect()).toBe(false);
   });

   it("lets an explicit true in a config file beat a plain tsconfig", async () => {
      await project.write({
         "tsconfig.json": tsconfig({ module: "ESNext" }),
         "autoipc.config.json": '{ "projectUsesNodeNext": true }',
      });
      expect(await detect()).toBe(true);
   });

   it("lets an override beat the tsconfig", async () => {
      await project.write({ "tsconfig.json": tsconfig({ module: "NodeNext" }) });
      const config = await cfg.getResolvedConfig({
         cwd: project.dir,
         overrides: { projectUsesNodeNext: false },
      });
      expect(config.projectUsesNodeNext).toBe(false);
   });

   it("names the file when the JSONC is invalid", async () => {
      await project.write({ "tsconfig.json": '{ "compilerOptions": { "module": }' });
      await expect(detect()).rejects.toThrowError(
         `Cannot parse '${project.root}/tsconfig.json': it is not valid JSON.`,
      );
   });

   it("names the file that extends a base that does not exist", async () => {
      await project.write({ "tsconfig.json": JSON.stringify({ extends: "./missing.json" }) });
      await expect(detect()).rejects.toThrowError(
         `Cannot read '${project.root}/tsconfig.json': the base config '${project.root}/missing.json' does not exist.`,
      );
   });

   it("names the base file when it is invalid", async () => {
      await project.write({
         "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
         "base.json": "{ nope",
      });
      await expect(detect()).rejects.toThrowError(`Cannot parse '${project.root}/base.json'`);
   });

   it("rejects a tsconfig that is not an object", async () => {
      await project.write({ "tsconfig.json": "[]" });
      await expect(detect()).rejects.toThrowError(`Cannot read '${project.root}/tsconfig.json'`);
   });
});
