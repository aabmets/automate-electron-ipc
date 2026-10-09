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

// Scopes against real windows: the preload script of each scope gives the page its API, and the
// main process admits a call only from the contents that are registered in a scope of the channel.
// A window may use the preload script of one scope while it is registered in another or in none, to
// show that the main process does not rely on the API of the page.

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const forbidden = { name: "IpcForbiddenError", code: "IPC_FORBIDDEN" };

const scenarios: Record<string, Scenario> = {
   surfaces: async (ctx) => {
      const surfaces: Record<string, unknown> = {};
      for (const [name, scope] of [
         ["plain", undefined],
         ["settings", "settings"],
         ["editor", "editor"],
      ]) {
         const win = await ctx.open({ scope });
         surfaces[name as string] = await ctx.evaluate(win, () =>
            Object.keys(ipc)
               .sort()
               .map((channel) => `${channel}:${Object.keys(ipc[channel]).sort().join("+")}`),
         );
      }
      return surfaces;
   },

   calls: async (ctx) => {
      // Four windows, which differ in the preload script and in what they are registered as.
      const windows = {
         settings: await ctx.open({ scope: "settings" }),
         editor: await ctx.open({ scope: "editor" }),
         unregistered: await ctx.open({ scope: "settings" }),
         mismatched: await ctx.open({ scope: "settings" }),
      };
      ctx.main.registerScope(windows.settings, "settings");
      ctx.main.registerScope(windows.editor, "editor");
      ctx.main.registerScope(windows.mismatched, "editor");
      const handled: string[] = [];
      ctx.ipc.getVersion.handle(async () => {
         handled.push("getVersion");
         return "1.0";
      });
      ctx.ipc.getSettings.handle(async () => {
         handled.push("getSettings");
         return "settings";
      });
      ctx.ipc.vault.handle(async () => {
         handled.push("vault");
         return "secret";
      });
      ctx.ipc.openFile.handle(async (_event: unknown, path: string) => {
         handled.push("openFile");
         return `file ${path}`;
      });
      const attempt = (win: unknown, channel: string, args: unknown[] = []) =>
         ctx.evaluate(
            win,
            async (name: string, list: unknown[]) => {
               if (!ipc[name]) {
                  return { missing: true };
               }
               try {
                  return { value: await ipc[name].invoke(...list) };
               } catch (cause: any) {
                  return { name: cause.name, code: cause.code };
               }
            },
            channel,
            args,
         );
      const results: Record<string, Record<string, unknown>> = {};
      for (const [name, win] of Object.entries(windows)) {
         results[name] = {
            getVersion: await attempt(win, "getVersion"),
            getSettings: await attempt(win, "getSettings"),
            vault: await attempt(win, "vault"),
            openFile: await attempt(win, "openFile", ["a.txt"]),
         };
      }
      return { results, handled: handled.sort() };
   },
};

describeElectron("scopes, invoke, in Electron", "electron-scopes", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   describe("the preload script of a scope", () => {
      it("gives the page the API of its scope, and nothing of the other scopes", () => {
         expect(group.value("surfaces")).toStrictEqual({
            plain: ["getVersion:invoke", "note:send"],
            settings: [
               "audit:send",
               "getSettings:invoke",
               "getVersion:invoke",
               "note:send",
               "vault:invoke",
            ],
            editor: [
               "audit:send",
               "exportRows:stream",
               "getVersion:invoke",
               "note:send",
               "openFile:invoke",
            ],
         });
      });
   });

   describe("invoke", () => {
      const row = (results: Record<string, any>, window: string) => results[window];

      it("lets every window call a channel without scopes", () => {
         const { results } = group.value("calls");
         for (const window of ["settings", "editor", "unregistered", "mismatched"]) {
            expect(row(results, window).getVersion).toStrictEqual({ value: "1.0" });
         }
      });

      it("lets the window of a scope call the channels of the scope", () => {
         const { results } = group.value("calls");
         expect(row(results, "settings")).toMatchObject({
            getSettings: { value: "settings" },
            vault: { value: "secret" },
         });
         expect(row(results, "editor").openFile).toStrictEqual({ value: "file a.txt" });
      });

      it("gives a page no channel of another scope in its API", () => {
         const { results } = group.value("calls");
         expect(row(results, "settings").openFile).toStrictEqual({ missing: true });
         expect(row(results, "editor").getSettings).toStrictEqual({ missing: true });
         expect(row(results, "editor").vault).toStrictEqual({ missing: true });
      });

      it("rejects a page which has the API of a scope, but is registered in no scope", () => {
         const { results } = group.value("calls");
         expect(row(results, "unregistered")).toMatchObject({
            getSettings: forbidden,
            vault: forbidden,
            openFile: { missing: true },
         });
      });

      it("rejects a page which has the API of a scope, but is registered in another", () => {
         const { results } = group.value("calls");
         expect(row(results, "mismatched")).toMatchObject({
            getSettings: forbidden,
            vault: forbidden,
         });
      });

      it("runs the handlers of the admitted calls only", () => {
         const { handled } = group.value("calls");
         expect(handled).toStrictEqual(
            [
               "getVersion",
               "getVersion",
               "getVersion",
               "getVersion",
               "getSettings",
               "vault",
               "openFile",
            ].sort(),
         );
      });
   });
});
