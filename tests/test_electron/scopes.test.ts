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

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
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

   sends: async (ctx) => {
      const settings = await ctx.open({ scope: "settings" });
      const editor = await ctx.open({ scope: "editor" });
      const unregistered = await ctx.open({ scope: "settings" });
      ctx.main.registerScope(settings, "settings");
      ctx.main.registerScope(editor, "editor");
      const received: string[] = [];
      const rejected: string[] = [];
      ctx.main.configureIpc({
         onRejected: (_event: unknown, channel: string) => rejected.push(channel),
      });
      ctx.ipc.audit.on((_event: unknown, text: string) => received.push(`audit ${text}`));
      ctx.ipc.note.on((_event: unknown, text: string) => received.push(`note ${text}`));
      await ctx.evaluate(settings, () => ipc.audit.send("from settings"));
      await ctx.evaluate(editor, () => ipc.audit.send("from editor"));
      await ctx.evaluate(unregistered, () => ipc.audit.send("from unregistered"));
      // A send without scopes shows that the dropped message had time to arrive.
      await ctx.evaluate(unregistered, () => ipc.note.send("from unregistered"));
      await ctx.waitFor(() => received.includes("note from unregistered"));
      await ctx.sleep(100);
      return { received: received.sort(), rejected };
   },

   streams: async (ctx) => {
      const editor = await ctx.open({ scope: "editor" });
      const unregistered = await ctx.open({ scope: "editor" });
      ctx.main.registerScope(editor, "editor");
      let started = 0;
      ctx.ipc.exportRows.handle(async function* () {
         started++;
         yield 1;
         yield 2;
      });
      const read = (win: unknown) =>
         ctx.evaluate(win, async () => {
            const chunks: number[] = [];
            try {
               for await (const chunk of ipc.exportRows.stream()) {
                  chunks.push(chunk);
               }
               return { chunks };
            } catch (cause: any) {
               return { chunks, name: cause.name, code: cause.code };
            }
         });
      return { editor: await read(editor), unregistered: await read(unregistered), started };
   },

   dispose: async (ctx) => {
      const win = await ctx.open({ scope: "settings" });
      const dispose = ctx.main.registerScope(win, "settings");
      ctx.ipc.getSettings.handle(async () => "settings");
      const call = () =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.getSettings.invoke() };
            } catch (cause: any) {
               return { name: cause.name, code: cause.code };
            }
         });
      const before = await call();
      dispose();
      const after = await call();
      ctx.main.registerScope(win, "settings");
      const again = await call();
      return { before, after, again };
   },

   iframe: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://other/frame.html"></iframe>');
      ctx.serve("app://other/frame.html", "<p>frame</p>");
      const win = await ctx.open({ scope: "settings", subframes: true });
      ctx.main.registerScope(win, "settings");
      const frame = win.webContents.mainFrame.frames[0];
      ctx.ipc.getSettings.handle(async () => "settings");
      ctx.ipc.vault.handle(async () => "secret");
      const call = (target: unknown) =>
         ctx.evaluate(target, async () => {
            const outcome: Record<string, unknown> = { origin: location.origin };
            for (const name of ["getSettings", "vault"] as const) {
               try {
                  outcome[name] = await ipc[name].invoke();
               } catch (cause: any) {
                  outcome[name] = { name: cause.name, code: cause.code };
               }
            }
            return outcome;
         });
      return { main: await call(win), frame: await call(frame) };
   },
};

describeElectron("scopes in Electron", "electron-scopes", scenarios, (group) => {
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

   describe("send", () => {
      it("delivers a send of a window of the scopes of the channel, and drops the others", () => {
         const { received, rejected } = group.value("sends");
         expect(received).toStrictEqual([
            "audit from editor",
            "audit from settings",
            "note from unregistered",
         ]);
         expect(rejected).toStrictEqual(["audit"]);
      });
   });

   describe("stream", () => {
      it("streams to the window of the scope, and fails the stream of another", () => {
         const { editor, unregistered, started } = group.value("streams");
         expect(editor).toStrictEqual({ chunks: [1, 2] });
         expect(unregistered).toMatchObject({ chunks: [], ...forbidden });
         expect(started).toBe(1);
      });
   });

   describe("the registration", () => {
      it("ends when the function that registerScope returned is called, and can be made again", () => {
         expect(group.value("dispose")).toStrictEqual({
            before: { value: "settings" },
            after: forbidden,
            again: { value: "settings" },
         });
      });

      it("covers the frames of the window, whose origin is still checked by allowedOrigins", () => {
         expect(group.value("iframe")).toStrictEqual({
            main: { origin: "app://main", getSettings: "settings", vault: "secret" },
            frame: { origin: "app://other", getSettings: "settings", vault: forbidden },
         });
      });
   });

   it("type-checks the generated files of every scope", async () => {
      const project = await runFixture("electron-scopes");
      try {
         for (const scope of ["default", "settings", "editor"]) {
            expect(await project.typecheckScope(scope)).toBe("");
         }
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
