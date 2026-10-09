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

// Where the generated preload script puts the API (T31, T32), in a real sandboxed preload:
// under the key of `exposeAs`, in the isolated world of `isolatedWorldId`, or nowhere until the
// preload script of the application composes it (`autoExpose: false`).

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const bridge: any;

/** The names of the globals of the page that the preload script could have exposed. */
const exposedGlobals = `["ipc", "bridge", "api", "second", "app"].filter((key) => key in window)`;

const exposeAsScenarios: Record<string, Scenario> = {
   exposeAs: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.getUser.handle(async (_event: unknown, id: number) => `user ${id}`);
      const logged: string[] = [];
      ctx.ipc.logLine.on((_event: unknown, text: string) => logged.push(text));
      await ctx.evaluate(win, () => {
         (window as any).progress = [];
         bridge.progress.on((percent: number) => (window as any).progress.push(percent));
      });
      const user = await ctx.evaluate(win, () => bridge.getUser.invoke(7));
      await ctx.evaluate(win, () => bridge.logLine.send("hello"));
      await ctx.waitFor(() => logged.length === 1);
      ctx.ipc.progress.send(win, 50);
      const progress = await ctx.until(
         win,
         () => (window as any).progress.length === 1 && (window as any).progress,
      );
      const globals = await win.webContents.executeJavaScript(ctx.data.exposedGlobals);
      return { user, logged, progress, globals };
   },
};

describeElectron(
   "exposeAs in Electron",
   "expose-as",
   exposeAsScenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("exposes the API under the key of exposeAs only, and it carries invoke, send and emit", () => {
         expect(group.value("exposeAs")).toStrictEqual({
            user: "user 7",
            logged: ["hello"],
            progress: [50],
            globals: ["bridge"],
         });
      });
   },
   { exposedGlobals },
);

const isolatedWorldScenarios: Record<string, Scenario> = {
   isolatedWorld: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.getUser.handle(async (_event: unknown, id: number) => `user ${id}`);
      const logged: string[] = [];
      ctx.ipc.logLine.on((_event: unknown, text: string) => logged.push(text));
      const inWorld = (code: string) =>
         win.webContents.executeJavaScriptInIsolatedWorld(ctx.data.worldId, [{ code }]);

      const mainWorld = await win.webContents.executeJavaScript(ctx.data.exposedGlobals);
      const isolated = await inWorld(`typeof api.getUser.invoke`);
      await inWorld(
         `window.progress = []; api.progress.on((percent) => progress.push(percent)); 0`,
      );
      const user = await inWorld(`api.getUser.invoke(5)`);
      await inWorld(`api.logLine.send("from the world"); 0`);
      await ctx.waitFor(() => logged.length === 1);
      ctx.ipc.progress.send(win, 75);
      await ctx.waitFor(async () => (await inWorld(`progress.length`)) === 1);
      const progress = await inWorld(`progress`);
      // Another world, such as the default world of the preload, does not have it either.
      const otherWorld = await win.webContents.executeJavaScriptInIsolatedWorld(
         ctx.data.worldId + 1,
         [{ code: `typeof api` }],
      );
      return { mainWorld, isolated, user, logged, progress, otherWorld };
   },
};

describeElectron(
   "isolatedWorldId in Electron",
   "isolated-world",
   isolatedWorldScenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("exposes the API in the isolated world only, where it carries invoke, send and emit", () => {
         expect(group.value("isolatedWorld")).toStrictEqual({
            mainWorld: [],
            isolated: "function",
            user: "user 5",
            logged: ["from the world"],
            progress: [75],
            otherWorld: "undefined",
         });
      });
   },
   { exposedGlobals, worldId: 1004 },
);

declare const app: any;
declare const second: any;

const composeScenarios: Record<string, Scenario> = {
   // The generated preload script alone exposes nothing with `autoExpose: false`.
   generatedAlone: async (ctx) => {
      const win = await ctx.open();
      return win.webContents.executeJavaScript(ctx.data.exposedGlobals);
   },

   // The preload script of the application (`preload.app.ts`) calls `expose` twice and uses `api`.
   composed: async (ctx) => {
      const win = await ctx.open({ scope: "app" });
      ctx.ipc.getUser.handle(async (_event: unknown, id: number) => `user ${id}`);
      const env = await ctx.evaluate(win, () => (window as any).__env);
      const globals = await win.webContents.executeJavaScript(ctx.data.exposedGlobals);
      const channels = await ctx.evaluate(win, () => app.channels());
      const greeting = await ctx.evaluate(win, () => app.greet(3));
      const viaKeys = await ctx.evaluate(win, async () => [
         await (window as any).ipc.getUser.invoke(1),
         await second.getUser.invoke(2),
      ]);
      return { env, globals, channels, greeting, viaKeys };
   },
};

describeElectron(
   "a composed preload script in Electron",
   "electron-compose",
   composeScenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("exposes nothing from the generated preload script with autoExpose: false", () => {
         expect(group.value("generatedAlone")).toStrictEqual([]);
      });

      it("lets the preload script of the app expose the API under its keys, and use it itself", () => {
         expect(group.value("composed")).toStrictEqual({
            env: { sandboxed: true, contextIsolated: true },
            globals: ["ipc", "second", "app"],
            channels: ["getUser", "logLine", "progress"],
            greeting: "hello, user 3",
            viaKeys: ["user 1", "user 2"],
         });
      });

      it("type-checks the generated files and the preload script of the app", async () => {
         const project = await runFixture("electron-compose");
         try {
            expect(await project.typecheck()).toBe("");
         } finally {
            await project.cleanup();
         }
      }, 120_000);
   },
   { exposedGlobals },
);
