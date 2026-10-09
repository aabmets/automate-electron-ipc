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

import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
   vi.restoreAllMocks();
});

describe("the generated files of a mainPort channel", () => {
   it("type-checks the usage of both sides", async () => {
      const project = await fixtures.run("main-port");

      expect(await project.typecheck()).toBe("");
   });

   it("gives the page the API of a port channel, whichever peer the channel has", async () => {
      const project = await fixtures.run("main-port");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      const members = (name: string) => Object.keys(fake.exposed.ipc[name]).sort();
      expect(members("logTail")).toStrictEqual(members("chat"));
      expect(members("logTail")).toStrictEqual([
         "on",
         "onClose",
         "onConnection",
         "onOverflow",
         "onReady",
         "send",
      ]);
      expect(project.generated["types.ts"]).toContain("logTail: {");
      expect(project.generated["types.ts"]).toContain(
         "send: (line: string, level?: number) => void;",
      );
   });

   it("has only the main-process helpers that its channels use", async () => {
      const project = await fixtures.run("main-port");
      const main = project.generated["main.ts"];

      expect(main).toContain("function connectMainPort(");
      expect(main).toContain("function connectPorts(");
      expect(main.match(/const portEnds = /g)).toHaveLength(1);
   });
});
