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

import { loadBoundedProject, loadPage } from "@testutils/e2e/port-queue-utils.js";
import { type E2EProject } from "@testutils/e2e-utils.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let project: E2EProject;

beforeAll(async () => {
   project = await loadBoundedProject();
});

afterAll(async () => {
   await project.cleanup();
});

afterEach(() => {
   vi.restoreAllMocks();
});

describe("the generated files of channels with a maxQueue", () => {
   it("type-checks the options, the callbacks and the misuse of them", async () => {
      expect(await project.typecheck()).toBe("");
   });

   it("type-checks under noUnusedLocals, which the helpers must satisfy", async () => {
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
   });

   it("exposes onOverflow on the channel and on every connection of the page", () => {
      const { ipc, pair } = loadPage();
      const connections: any[] = [];
      ipc.chat.onConnection((connection: unknown) => connections.push(connection));

      pair("chat");

      expect(typeof ipc.chat.onOverflow).toBe("function");
      expect(typeof connections[0].onOverflow).toBe("function");
   });

   it("declares the overflow types in window.d.ts and the exports of main.ts", () => {
      const windowTypes = project.generated["window.d.ts"];
      const main = project.generated["main.ts"];

      expect(windowTypes).toContain("interface IpcPortOverflowInfo {");
      expect(windowTypes).toContain(
         "type IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';",
      );
      expect(windowTypes).toContain(
         "onOverflow: (callback: (message: Parameters<(line: string, level?: number) => void>, info: IpcPortOverflowInfo) => IpcPortOverflowAction) => () => void;",
      );
      expect(main).toContain("export interface PortOverflowInfo {");
      expect(main).toContain("export function configurePorts(config: PortsConfig): void {");
   });

   it("writes the maxQueue of each channel into both scripts", () => {
      const main = project.generated["main.ts"];
      const preload = project.generated["preload.ts"];

      expect(main).toContain("connectMainPort('autoipc:logTail', 'logTail', 3, target)");
      expect(main).toContain("connectMainPort('autoipc:meters', 'meters', 0, target)");
      expect(main).toContain("connectMainPort('autoipc:frames', 'frames', Infinity, target)");
      expect(main).toContain("connectMainPort('autoipc:defaulted', 'defaulted', 1000, target)");
      expect(preload).toContain("createPortChannel('chat', 'autoipc:chat', 2)");
      expect(preload).toContain("createPortChannel('nobody', 'autoipc:nobody', 0)");
      expect(preload).toContain("createPortChannel('plain', 'autoipc:plain', 1000)");
      expect(preload).toContain("createPortChannel('frames', 'autoipc:frames', Infinity)");
   });
});
