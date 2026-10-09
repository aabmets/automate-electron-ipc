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

// A custom `channelPrefix` must reach both sides: the generated preload script and the generated
// main process code have to agree on the names of the channels that Electron really carries.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   prefix: async (ctx) => {
      const { ipcMain } = ctx.electron;
      const win = await ctx.open();
      const handled: string[] = [];
      const original = ipcMain.handle;
      ipcMain.handle = (channel: string, listener: unknown) => {
         handled.push(channel);
         return original.call(ipcMain, channel, listener);
      };
      try {
         ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `user ${id}`);
      } finally {
         ipcMain.handle = original;
      }
      const logged: unknown[] = [];
      ctx.ipc.log.on((_event: unknown, text: string) => logged.push(text));
      await ctx.evaluate(win, () => {
         (window as any).notices = [];
         ipc.notice.on((text: string) => (window as any).notices.push(text));
      });

      const value = await ctx.evaluate(win, () => ipc.getValue.invoke(4));
      await ctx.evaluate(win, () => ipc.log.send("hello"));
      await ctx.waitFor(() => logged.length === 1);
      ctx.ipc.notice.send(win, "news");
      const notices = await ctx.until(
         win,
         () => (window as any).notices.length === 1 && (window as any).notices,
      );
      return { value, logged, notices, handled, listened: ipcMain.eventNames().map(String) };
   },
};

describeElectron("channelPrefix in Electron", "electron-prefix", scenarios, (group) => {
   it("runs every scenario to completion, without uncaught errors in the main process", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("carries invoke, send and emit between a page and the main process", () => {
      const { value, logged, notices } = group.value("prefix");
      expect(value).toBe("user 4");
      expect(logged).toStrictEqual(["hello"]);
      expect(notices).toStrictEqual(["news"]);
   });

   it("registers the prefixed names in ipcMain, and not the default ones", () => {
      const { handled, listened } = group.value("prefix");
      expect(handled).toStrictEqual(["my-app/v1:getValue"]);
      expect(listened).toContain("my-app/v1:log");
      expect(listened.filter((name: string) => name.startsWith("autoipc:"))).toStrictEqual([]);
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-prefix");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
